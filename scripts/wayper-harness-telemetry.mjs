import crypto from 'node:crypto';

export const UNKNOWN = 'UNKNOWN';
export const TRACE_SCHEMA_VERSION = 1;
export const ORIGINS = Object.freeze(['SYSTEM', 'DEVELOPER', 'PROJECT_POLICY', 'AGENTS', 'GOAL', 'BASELINE',
  'WORKING_CONTEXT', 'CONTEXT_PACKET', 'SOURCE', 'DOCUMENTATION', 'GRAPH', 'TOOL_OUTPUT', 'VALIDATION',
  'EVIDENCE', 'COMPLETION', 'FEEDBACK', 'MEMORY', 'HANDOFF', 'HISTORY', 'OTHER', 'INTERNAL_UNKNOWN']);
export const MECHANISMS = Object.freeze(['Goal Identity', 'Evidence', 'ValidationPlan', 'Completion',
  'Context Economy', 'Graphify', 'Dispatch', 'Ownership', 'CrossRepo', 'Memory', 'Feedback']);

const hash = (value) => `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
const bytes = (value) => Buffer.byteLength(value, 'utf8');
const measured = (value) => Number.isSafeInteger(value) && value >= 0 ? value : UNKNOWN;

// The CLI exposes turn usage, not individual provider requests. Event order is observable;
// JSONL event timestamps and the model-visible history at each request are not.
export function makeTrace({ runId, trialId, attemptId, candidate, candidateSha, goalId, risk, model,
  reasoningEffort, cliVersion, prompt, jsonl, complete, runKind = 'BENCHMARK_TRIAL', sourceProjection = [], projectEvents = [] }) {
  const seen = new Map(); const events = []; const components = []; const tools = [];
  const register = (origin, source, content, eventId, visibility) => {
    const contentHash = hash(content); const firstOccurrence = seen.get(contentHash) ?? eventId;
    if (!seen.has(contentHash)) seen.set(contentHash, eventId);
    return { origin, source, bytes: bytes(content), estimatedTokens: UNKNOWN, contentHash,
      firstOccurrence, reused: firstOccurrence !== eventId, previousCallReference: UNKNOWN, visibility };
  };
  const blocks = prompt.split('\n\n');
  for (let i = 0; i < blocks.length; i++) {
    components.push(register(i === 4 ? 'GOAL' : 'OTHER', `candidate-prompt:${i + 1}`, blocks[i], `prompt-${i + 1}`, 'EXPLICIT_PROMPT'));
  }
  const projectedFiles = sourceProjection.map(({ origin, source, content }, index) => {
    if (!ORIGINS.includes(origin) || typeof source !== 'string' || typeof content !== 'string') throw new Error('INVALID_SOURCE_PROJECTION');
    return register(origin, source, content, `projection-${index + 1}`, 'PROJECTED_NOT_SENT');
  });
  const usage = []; let threadId = UNKNOWN; let turnStarted = false; let turnEnded = false; let turnCompleted = false;
  const compactionEvents = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    let event; try { event = JSON.parse(line); } catch { continue; }
    const eventId = `event-${events.length + 1}`;
    const row = { eventId, timestamp: UNKNOWN, eventType: event.type ?? UNKNOWN, source: 'CODEX_JSONL' };
    if (event.type === 'thread.started' && typeof event.thread_id === 'string') threadId = event.thread_id;
    if (event.type === 'turn.started') turnStarted = true;
    if (event.type === 'turn.completed' || event.type === 'turn.failed') turnEnded = true;
    if (event.type === 'turn.completed') turnCompleted = true;
    if (typeof event.type === 'string' && /compact/i.test(event.type)) compactionEvents.push(eventId);
    if (event.type === 'turn.completed') {
      const value = event.usage ?? {};
      usage.push({ eventId, inputTokens: measured(value.input_tokens), cachedInputTokens: measured(value.cached_input_tokens),
        cacheWriteInputTokens: measured(value.cache_write_input_tokens), outputTokens: measured(value.output_tokens),
        reasoningTokens: measured(value.reasoning_output_tokens) });
    }
    if (event.type === 'item.started' && event.item && event.item.type !== 'agent_message') {
      row.toolCall = { id: event.item.id ?? UNKNOWN, type: event.item.type, commandHash: typeof event.item.command === 'string'
        ? hash(event.item.command) : UNKNOWN };
    }
    if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
      const output = event.item.aggregated_output;
      const component = typeof output === 'string'
        ? register('TOOL_OUTPUT', event.item.id ?? UNKNOWN, output, eventId, 'CLI_AGGREGATED_OUTPUT') : null;
      tools.push({ eventId, itemId: event.item.id ?? UNKNOWN, type: event.item.type,
        outputBytes: component?.bytes ?? UNKNOWN, outputHash: component?.contentHash ?? UNKNOWN,
        firstOccurrence: component?.firstOccurrence ?? UNKNOWN, reused: component?.reused ?? UNKNOWN,
        outputCompleteness: UNKNOWN,
        nextModelCall: UNKNOWN, subsequentReinjections: UNKNOWN });
      if (component) components.push(component);
    }
    events.push(row);
  }
  let observedSpawns = UNKNOWN;
  const mechanisms = Object.fromEntries(MECHANISMS.map((name) => [name, { status: 'UNKNOWN',
    timestamp: UNKNOWN, reasonCode: UNKNOWN, riskJustification: UNKNOWN }]));
  for (const event of projectEvents) {
    if (event?.type === 'mechanism_activation' && MECHANISMS.includes(event.mechanism)) {
      mechanisms[event.mechanism] = { status: 'ACTIVATED', timestamp: event.timestamp ?? UNKNOWN,
        reasonCode: event.reasonCode ?? UNKNOWN, riskJustification: event.riskJustification ?? UNKNOWN };
      events.push({ eventId: `project-${events.length + 1}`, timestamp: event.timestamp ?? UNKNOWN,
        eventType: 'mechanism_activation', source: 'PROJECT_OWNED', mechanism: event.mechanism });
    }
    if (event?.type !== 'specialist_spawn' || typeof event.agentId !== 'string' || !event.agentId) continue;
    if (observedSpawns === UNKNOWN) observedSpawns = 0;
    observedSpawns++;
    events.push({ eventId: `project-${events.length + 1}`, timestamp: event.timestamp ?? UNKNOWN,
      eventType: 'specialist_spawn', source: 'PROJECT_OWNED', agent: { identity: event.agentId,
        role: event.role ?? UNKNOWN, parent: event.parent ?? UNKNOWN, depth: measured(event.depth) } });
  }
  const trace = { schemaVersion: TRACE_SCHEMA_VERSION, runKind, runId, trialId, attemptId, candidate, candidateSha, goalId, risk,
    model, reasoningEffort, cliVersion, status: complete && turnCompleted ? 'COMPLETE' : 'INCOMPLETE',
    threadId, turnStarted, turnEnded, tokenGranularity: 'TURN', modelCallCount: UNKNOWN,
    modelCallTokens: UNKNOWN, contextWindowTokens: UNKNOWN,
    compaction: compactionEvents.length ? { observedEvents: compactionEvents } : UNKNOWN, providerRequestId: UNKNOWN,
    agent: { identity: threadId, role: 'main', parent: UNKNOWN, depth: 0,
      projectOwnedSpecialistSpawns: observedSpawns, internalAgentActivity: UNKNOWN },
    context: { totalBytes: UNKNOWN, components, sourceProjection: projectedFiles,
      internal: 'INTERNAL_UNKNOWN', subsequentReinjections: UNKNOWN },
    tools: { observedCalls: events.filter((item) => item.toolCall).length,
      observedCommandCalls: events.filter((item) => item.toolCall?.type === 'command_execution').length, outputs: tools },
    usage, mechanisms, events };
  validateTrace(trace);
  return trace;
}

export function validateTrace(trace) {
  if (trace?.schemaVersion !== TRACE_SCHEMA_VERSION || !['COMPLETE', 'INCOMPLETE'].includes(trace.status) ||
    !['BENCHMARK_TRIAL', 'DIAGNOSTIC_REPLAY', 'DIAGNOSTIC_EXEC_NATIVE_TELEMETRY'].includes(trace.runKind) ||
    trace.tokenGranularity !== 'TURN' || trace.modelCallCount !== UNKNOWN ||
    !Array.isArray(trace.events) || !Array.isArray(trace.context?.components) ||
    Object.keys(trace.mechanisms ?? {}).join('|') !== MECHANISMS.join('|')) throw new Error('INVALID_TRACE_SCHEMA');
  for (const key of ['runId', 'trialId', 'attemptId', 'candidate', 'candidateSha', 'goalId', 'risk', 'model',
    'reasoningEffort', 'cliVersion']) if (typeof trace[key] !== 'string' || !trace[key]) throw new Error(`INVALID_TRACE_${key}`);
  if (new Set(trace.events.map((event) => event.eventId)).size !== trace.events.length) throw new Error('DUPLICATE_TRACE_EVENT_ID');
  for (const component of [...trace.context.components, ...(trace.context.sourceProjection ?? [])]) if (!ORIGINS.includes(component.origin) ||
    !Number.isSafeInteger(component.bytes) || component.bytes < 0 || !/^sha256:[a-f0-9]{64}$/.test(component.contentHash)) {
    throw new Error('INVALID_TRACE_COMPONENT');
  }
  for (const value of Object.values(trace.mechanisms)) if (!['ACTIVATED', 'NOT_ACTIVATED', 'UNKNOWN'].includes(value.status)) {
    throw new Error('INVALID_MECHANISM_STATUS');
  }
  return true;
}

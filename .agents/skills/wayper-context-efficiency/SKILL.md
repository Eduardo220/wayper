---
name: wayper-context-efficiency
description: Use automatically for every native Wayper Codex Goal and for explicit Harness context-efficiency work; reuses fingerprinted Working Context while preserving evidence, risk, invariants, and validation. Not for ordinary non-Goal product tasks.
---

# Wayper context efficiency

Reduce context waste while the main Codex agent remains the sole orchestrator
and writer of Harness state.

## Boundaries

- Apply this skill at native Goal start/resume before loading task-specific
  context. It composes with `TASK_MODE` or `META_GOAL_MODE`; it does not decide
  which mode applies.
- Do not create `wayper_context_manager`, a context agent, router, daemon, hook,
  memory store, vector DB, Obsidian dependency, or nested agent hierarchy.
- Keep `S0` as default, one writer per file/wave, and subagent `max_depth=1`.
- Markdown under `.wayper-context/` is the persistent Working Context and owns
  its Goal-scoped `CONTEXT_MAP`. The Node helper only hashes, compares, validates,
  and updates that state; the main agent owns
  interpretation, risk, evidence, Graphify, tests, and completion.
- Source, tests, approved docs, and current behavior remain authoritative.
  `KNOWN_GOOD_UNCHANGED` is scoped reuse evidence, never product truth.

Read [`docs/ai/working-context.md`](../../../docs/ai/working-context.md) when
creating or repairing Working Context state. Load other Harness owners only when
the current Goal/slice needs them.

## Goal start and resume

1. Read the Goal and obtain its host `threadId`. A thread is not a Goal execution.
   On an explicit new Goal, create a fresh project-owned `goalRunId`; never infer
   equality from text or import another run. On resume, use the recorded
   `goalRunId` and `revision` with that `threadId`. Missing identity requires
   locating the explicit execution reference, not selecting by thread alone.
2. Ground in branch/status, then classify task, flags, domains, gate, review, and
   orchestration route before broad reading.
3. Track only the initial owner/ranges and explicit proof requirements:

   ```sh
   node scripts/wayper-context.mjs start --thread-id <threadId> \
     --objective '<logical objective>' --class <TASK_CLASS> \
     --track AGENTS.md --track docs/00-fontes-do-projeto.md#L1-L32 \
     --risk <RISK_FLAG> --invariant <INVARIANT> --validation <CHECK> \
     --requirement SUCCESS:<criterion>
   ```

   Store the returned `GOAL_RUN_ID` and `REVISION`. Start captures the immutable
   revision baseline; subsequent refresh updates only current repository state.
   The same command initializes repository state and staleness in the
   embedded `CONTEXT_MAP`; do not create another map file.

   Prefix site artifacts with `wayper-site:` and pass both repository definitions;
   never encode a sibling checkout with `../` in an artifact path.

4. On resume, run `context:refresh -- --thread-id <threadId> --goal-run-id
   <goalRunId> --revision <N>` before rereading. Every other command, including
   Packet/Handoff CLI, uses this exact selector. Legacy `--goal-id` is
   inspection-only and yields `LEGACY_UNVERIFIED`, never reusable proof. Follow each
   artifact status:
   - `KNOWN_GOOD_UNCHANGED`: reuse the recorded proof; do not reread.
   - `REUSE_BEFORE_READ`: reuse for discovery, but obtain proof before a material
     claim.
   - `DIFF_BEFORE_FILE`: inspect the current diff first, then only affected
     symbols/ranges, callers, and tests.
   - `READ_REQUIRED`: load the smallest sufficient range.
5. Material amendments use explicit `amend --changes <JSON> --reason <reason>`
   with the current selector; keep the run ID and consume revision N+1. Use
   partial `--invalidate` only when source/dependencies prove the unaffected
   slices; otherwise default to full invalidation. Copy/metadata alone is not an
   amendment. Never revise the historical baseline.
   Add dependencies only after source confirms them. Refresh just the added or
   changed artifact specs; repository changes also revalidate tracked artifacts.
   Adding/changing requirements, risks, invariants or checks requires amendment.
6. Record proof with `context:prove` using a compatible verified Evidence Receipt
   ID from the project-owned file observer or runner. Follow
   [`evidence-receipts.md`](../../../docs/ai/evidence-receipts.md).
   Text, direct shell output and handoff assertions do not create receipts.
   Legacy refs are unverified; receipts never carry forward across revisions.
   For validation planning, supply confirmed per-repository scope, capabilities,
   risks, platforms and classified criteria to `validation-plan` in the existing
   Context Map writer. Follow [`validation-planner.md`](../../../docs/ai/validation-planner.md).
   Candidate checks are not executions; unavailable physical proof is not PASS.
7. Add only new compact map entries with `wayper-context.mjs record`; use
   `inspect`, `stats`, `evidence`, `gaps`, and `validate` read-only. Persist the
   router only through the explicit command. Trust specialist selection only
   from a validated `ROUTER_SELECTED` receipt; fallback remains behavioral.

Artifact specs accept a file or stable-enough range such as
`path/file.js#L20-L80`. A range fingerprint prevents an unrelated edit elsewhere
in the file from invalidating proven context. When line movement or semantics
make the range unsafe, track the containing symbol/file instead.

## Loading order

Use this order and stop at the first level that proves the requirement:

1. Working Context, `CONTEXT_MAP` refs, and their fingerprints (`reuse-before-read`).
2. Current diff for changed tracked artifacts (`diff-before-file`).
3. Symbol/heading plus failure path.
4. Direct callers/consumers and causal tests.
5. Domain docs/skill, memory lookup, or deeper dependency closure by routing.
6. Targeted Graphify or specialist only for remaining structural/risk uncertainty.

Never exchange required reasoning, safety, validation, accessibility, privacy,
or invariants for a budget. Budget pressure narrows optional discovery and
ceremony; required context is loaded with an explicit escalation reason.

## Context budgets

These are initial context-token proxy ceilings, not quotas or native Goal hard
caps. The proxy is `ceil(UTF-8 bytes / 4)` and must be labeled as a proxy.

| Class | Context ceiling | Subagent brief ceiling |
| --- | ---: | ---: |
| `TRIVIAL` | 1,500 | 0 |
| `BOUNDED` | 4,000 | 0 |
| `BUG` | 8,000 | 800 |
| `INVESTIGATION` | 10,000 | 800 |
| `ARCHITECTURAL` | 16,000 | 1,200 |
| `CRITICAL_RUNTIME` | 24,000 | 1,600 |

`CRITICAL_RUNTIME` overrides the primary class for the context ceiling. Exceed a
ceiling only when named missing evidence, risk, invariant, caller, or validation
requires it; record `BUDGET_ESCALATION_REASON`. Never split/minify evidence to
make the metric pass.

## Targeted and incremental Graphify

- Do not build a graph when source search already proves ownership/impact.
- If no current graph exists and structural uncertainty remains, select the
  repository first and run `npm run graphify:build -- mobile|site`. This creates
  a code-only/no-cluster cache only in that repository's ignored
  `graphify-out/`; never build or merge the workspace root graph.
- If a graph exists, compare the tracked source fingerprints first. Reuse it
  when the relevant scope is unchanged; run `npm run graphify:update --
  mobile|site` only when tracked source changed.
- Query only the unresolved symbol/path using `query --budget`, `path`,
  `affected`, or `explain`. Do not dump the graph or traverse unrelated
  communities.
- Cross-repo Goals query both repo-scoped graphs separately and combine source
  evidence afterward; they never create a mixed dependency graph.
- Confirm every material Graphify result in current source/callers/tests. Graph
  and manifest are generated caches, not Working Context truth.

## Subagent package and routing

No Goal implies delegation. Route proportionally:

- `TRIVIAL`/`BOUNDED`: `S0`.
- `BUG`/`INVESTIGATION`: `S0`; `S1/S2` only for a concrete specialist risk or
  independent read-only question.
- `ARCHITECTURAL`: `S0` until ownership/DAG are proven; specialists remain
  read-only unless existing `S3` eligibility passes.
- `CRITICAL_RUNTIME`: serial implementation; specialists only for confirmed
  flags.

When delegation is already authorized and either the Decision Gate or a valid
`ROUTER_SELECTED` receipt selected one of the Registry V2 read-only specialists,
call `preparePacketizedSpecialist`, send its
Context Packet with `fork_turns=none`, and accept only
`consumePacketizedSpecialist` output. The router receipt may choose the profile,
but changes neither S0-S3 nor spawn authority.
This mandatory boundary is `HARNESS_SPECIALIST_DISPATCH_V1`; pass the exact
per-dispatch model and reasoning returned by its policy and record them in the
validated dispatch receipt. Never invoke a selected project specialist through
a second Harness path.
If packet preparation or handoff validation returns `FALLBACK`, use only the
previous bounded package below for the same already-selected specialist:

```text
OUTCOME | SCOPE | FILES_OR_SYMBOLS | CONSTRAINTS | RISK_FLAGS
EVIDENCE_NEEDED | VALIDATION | RELEVANT_LEARNING_DELTA
```

For Registry specialists, use `fork_turns=none`; never copy full
history/source/docs the subagent can open, and keep `max_depth=1`. Other native
delegation uses the smallest safe `fork_turns`. Follow-ups contain only missing
delta.

## Delta-only and stop-when-proven

Intermediate updates, subagent returns, follow-ups, and repeated Goal reports
contain only new facts, changed decisions, invalidated evidence, blockers, and
next action. Final delivery remains self-contained but omits replayed history.
Caveman may compress ceremony/output; it never compresses persisted Markdown,
exact evidence, errors, numbers, or safety statements.

Stop loading context, querying Graphify, or spawning agents when every required
criterion/invariant/risk/validation has evidence, all declared checks passed or
are evidenced as not applicable, all tracked artifacts are `PROVEN` or
`KNOWN_GOOD_UNCHANGED`, and the Context Map has no open gap, questioned/stale
known-good, or unresolved staleness. Continue work only if the Goal itself still
has an unproven requirement; unused budget never creates work. This decision
stops context expansion only; native Goal completion remains authoritative.
Record each assurance explicitly as `risk:<FLAG>` or `invariant:<ID>`; a generic
PASS cannot cover unrelated assurances. Required Graphify must be `CURRENT`.

## Validation

Run `npm run quality:context`, `wayper-context.mjs validate`, the affected Harness owner gate, and
`git diff --check`. The context gate must fail if a benchmark saves context by
dropping any declared test, validation, risk flag, or invariant. Run
`quality:capabilities` when registry/skill routing changes and
`quality:meta-goal` when Goal completion/budget behavior changes.

## Output contract

Retain `CONTEXT_DELTA`, `INVALIDATED`, `REUSED`, `BUDGET`, `GRAPHIFY`,
`AGENT_ROUTE`, `PROOF_GAPS`, and `DECISION`. Expose only the delta needed for the
current update and the user's requested final evidence.

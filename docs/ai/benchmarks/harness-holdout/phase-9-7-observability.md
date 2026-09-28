# Fase 9.7 — contrato de observabilidade diagnóstica

Este contrato é posterior ao blind holdout. `freeze.json`, `suite.json`, scorer, candidates e resultados históricos continuam imutáveis. O replay usa `gpt-6-sol`/`high`/`codex-cli 0.155.1` e grava apenas em `.wayper-context/benchmark-runs/diagnostic-replay/` com `kind=DIAGNOSTIC_REPLAY`.

## Auditoria do runtime

CLI local `0.155.1`: `codex exec --json --ephemeral` emite `thread.started`, `turn.started`, `item.started`, `item.completed`, `turn.completed` ou `turn.failed`/`error`. Os 49 attempts do holdout emitiram 48 `turn.completed` e um `turn.failed`; os tipos de item observados foram `agent_message`, `command_execution` e `file_change`. Nenhum evento `model.request`, `model.response` ou `compact` apareceu nesse corpus. Ausência do evento não prova ausência da ação interna.

`codex debug prompt-input` renderiza a lista inicial de mensagens visíveis ao modelo em uma invocação separada. Ele não mostra o histórico de cada request no trial. O protocolo gerado por `codex app-server generate-ts --experimental` contém `rawResponse/completed` com uso de uma resposta upstream, `thread/tokenUsage/updated`, item `contextCompaction`, `thread/compacted` e `subAgentActivity`. `RawResponseCompletedNotification` está documentado como **internal-only** no tipo gerado. O runner usa `codex exec`, não app-server; migrar o transporte ou remover `--ephemeral` para ler rollouts mudaria o instrumento observado e exige validação própria (`OBSERVER_EFFECT_RISK`). Hooks `PreCompact`, `PostCompact`, `SubagentStart` e `SubagentStop` constam no protocolo, mas sua ativação também altera a configuração do runtime do candidate e não faz parte do replay principal.

| Metric | Available | Source | Granularity | Reliability |
| --- | --- | --- | --- | --- |
| input/output/cached/cache-write/reasoning tokens | YES quando presentes | `turn.completed.usage` | TURN | PROVEN |
| model-call count e tokens por call | NO no `exec --json` observado | app-server tem interface interna distinta | UNKNOWN | NOT_OBSERVABLE_IN_RUNNER |
| provider request ID | NO no `exec --json` observado | app-server `rawResponse/completed.responseId` em outro transporte | UNKNOWN | NOT_OBSERVABLE_IN_RUNNER |
| context window, histórico enviado, truncation, reinjeção posterior | NO no `exec --json` observado | provider/Codex interno | UNKNOWN | NOT_OBSERVABLE_IN_RUNNER |
| compaction | evento possível em outro protocolo; nenhum no JSONL observado | app-server/hook, se ativado | EVENT | PARTIAL |
| turn/thread start/end | YES | JSONL | TURN/THREAD | PROVEN |
| tool call e output observado | YES para `item.started/completed`; `aggregated_output` pode ser limitado | JSONL | ITEM | PROVEN para bytes do campo, não para output integral |
| prompt criado pelo runner | YES | função `prompt()` sem mudança | EXPLICIT_BLOCK | PROVEN |
| source/AGENTS/fixture projetados | YES | cópia cega e fixture do runner | PROJECTED_FILE | PROVEN como projeção; envio ao modelo UNKNOWN |
| specialist project-owned | somente receipt confiável fornecido pelo owner | `projectEvents`; não fornecido pelo CLI do replay | EVENT | UNKNOWN no replay sem receipt |
| agentes internos do Codex | NO no `exec --json` observado | runtime interno | UNKNOWN | NOT_OBSERVABLE_IN_RUNNER |
| mecanismos do Harness ativados | somente evento project-owned confiável | `projectEvents`; não fornecido pelo CLI do replay | EVENT | UNKNOWN sem receipt |

## Trace v1

Owner: `scripts/wayper-harness-telemetry.mjs`. Cada attempt recebe `trace.json` versionado e hash referenciado por `attempt.json` e `result.json`. Identity: run/trial/attempt, candidate SHA, Goal, risk, model/effort/CLI, thread ID e status `COMPLETE`/`INCOMPLETE`. Uso fica em `usage[]` por turn; `modelCallCount`, tokens por call, janela e reinjeção são literalmente `UNKNOWN`. `runKind=DIAGNOSTIC_REPLAY` separa o replay do holdout.

`context.components[]` inclui somente blocos explícitos do prompt e `aggregated_output` observado. `context.sourceProjection[]` registra arquivos disponíveis ao candidate, com `visibility=PROJECTED_NOT_SENT`: isso **não** afirma que o arquivo entrou no contexto. Cada bloco guarda origem, bytes, SHA-256, primeira ocorrência e repetição idêntica dentro do attempt. `estimatedTokens` e referência a call permanecem `UNKNOWN`. O texto bruto da projeção e das saídas não é duplicado no trace; stdout bruto continua no artefato já existente. As origens admitidas são `SYSTEM`, `DEVELOPER`, `PROJECT_POLICY`, `AGENTS`, `GOAL`, `BASELINE`, `WORKING_CONTEXT`, `CONTEXT_PACKET`, `SOURCE`, `DOCUMENTATION`, `GRAPH`, `TOOL_OUTPUT`, `VALIDATION`, `EVIDENCE`, `COMPLETION`, `FEEDBACK`, `MEMORY`, `HANDOFF`, `HISTORY`, `OTHER`, `INTERNAL_UNKNOWN`.

O trace preserva ordem dos eventos, mas o JSONL de `exec` observado não contém timestamp por evento; o valor é `UNKNOWN`. `tools.outputs[].nextModelCall` e `subsequentReinjections` ficam `UNKNOWN`. `projectEvents` é uma entrada opcional para receipts do control plane; o replay congelado não a fornece. Sem receipt, zero spawns ou zero mecanismos não são inferidos.

## Não interferência e overhead

O parser roda após o processo e escreve fora do workspace cego. Testes verificam prompt exato, SHA congelado, binário/effort, invisibilidade de telemetry/GroundTruth e mesma invocação `exec`; não há nova tool call para medir. Os nomes novos filtrados da projeção nem existem nos commits congelados. Em fixture com stdout real de H10-T2-V2 (125.650 bytes), 100 iterações locais deram 0,414 ms por parse antigo e 0,886 ms por trace novo: acréscimo de 0,472 ms; trace serializado 14.975 bytes. Medição cobre parse em memória, não custo integral de I/O, scheduler ou provider. Neutralidade do prompt/projeção está testada; neutralidade estatística da trajetória do modelo não pode ser provada sem requests internos.

Rollback: reverter o commit desta instrumentação; os candidates, freeze e corpus histórico não dependem do trace. Não interpretar um `UNKNOWN` como zero nem misturar `diagnostic-replay` com `holdout`.

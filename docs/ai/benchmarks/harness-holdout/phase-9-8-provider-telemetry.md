# Fase 9.8 — experimento de telemetria do provider

Data: 2026-09-25. Escopo: diagnóstico somente. Os commits V1 `2db95d40567564cf3bb6727096b81d448b1dd765`, V2_TUNED_FINAL `7adb4f1e7970ff79a0848c763207109416c6db1d` e instrumentação base `87f319797d764f08dfd8afe4d02d4cc3f123d69f` não foram alterados. O blind holdout permanece V1 23/24 e V2 23/24. Nenhum resultado desta fase entra no scorer ou no corpus histórico.

## VERDICT

| Item | Veredito | Base |
| --- | --- | --- |
| Transport | `INCONCLUSIVE` | A fixture demonstrou mesma tarefa/checkout/projeção e decisões, mas não provou mesmo contexto interno e ferramentas disponíveis; as leituras efetivas variaram. |
| Telemetry | `PARTIAL` | `rawResponse/completed` experimental forneceu usage por response em 3/3 trials app. Não há request ID, response-start ou histórico exato por request. |
| Diagnosis | `STILL_UNOBSERVABLE` | O gate impediu H10/H11, portanto não há response trace desses cenários. |
| Gate | `TRANSPORT_NOT_EQUIVALENT` | Equivalência suficiente para diagnosticar variância de contexto não foi demonstrada. |

## APP-SERVER CAPABILITY MATRIX

Fonte principal: schema **gerado pelo binário local 0.155.1**, com `codex app-server generate-json-schema --experimental --out /tmp/wayper-app-schema-01551`, mais um probe vivo e as três execuções app da fixture. [Documentação oficial do protocolo](https://learn.chatgpt.com/docs/app-server). `SCHEMA` significa que a forma existe; `OBSERVED` significa evento recebido neste ambiente. Não se presume que todo evento descrito seja emitido em cada run.

| Metric | Available | Event/source | Granularity | Reliability |
| --- | --- | --- | --- | --- |
| Response started | UNKNOWN | Sem evento dedicado observado | UNKNOWN | NOT_VERIFIED |
| Response completed | YES | `rawResponse/completed` com `experimentalRawEvents=true` | response | OBSERVED 6 responses |
| Usage por response | YES quando presente | `rawResponse/completed.usage`; schema aceita `null` | response | OBSERVED 6/6; internal-only/experimental |
| Input, cached, output, reasoning tokens | YES quando presentes | `TokenUsageBreakdown` no evento acima | response | OBSERVED 6/6 |
| Fresh input | DERIVED | `inputTokens - cachedInputTokens` | response | Válido quando ambos presentes |
| Provider request ID | UNKNOWN | Nenhum campo distinto no evento | UNKNOWN | NOT_VERIFIED |
| Response ID | YES | `rawResponse/completed.responseId` | response | OBSERVED 6/6 |
| Turn ID, thread ID | YES | `turn/started`, `rawResponse/completed`, `turn/completed` | turn/thread | OBSERVED |
| Tool-call boundaries | YES em schema | `item/started`, `item/completed` | item | Completed OBSERVED; started não persistido pelo experimento |
| Compaction | POSSIBLE | `contextCompaction` item; `thread/compacted` obsoleto | event | Nenhum observado; ocorrência real UNKNOWN |
| Context-window size | YES quando presente | `thread/tokenUsage/updated.tokenUsage.modelContextWindow` | update | OBSERVED `258400`; uso da janela por request UNKNOWN |
| History/context metadata | PARTIAL | `rawResponseItem/completed` traz metadados e conteúdo bruto de itens | item | Itens brutos podem ser sensíveis; só papel/tipo/bytes foram persistidos; histórico exato por request UNKNOWN |
| Model, effort | YES | `thread/settings/updated` no probe; parâmetros `thread/start`/`turn/start` | thread/turn | OBSERVED no probe; configuração enviada em todos os trials |
| Agent/subagent identity | PARTIAL | schema `subAgentActivity` e fontes de subagent | event | Nenhum subagent observado na fixture; atribuição por response UNKNOWN |
| Rate limit/quota metadata | PARTIAL | `account/rateLimits/updated` | account update | OBSERVED; não é usage de response nem prova de quota por request |
| Model reroute | POSSIBLE | `model/rerouted` | event | Não observado |

O schema descreve `rawResponse/completed` como **internal-only**. O probe com `experimentalRawEvents=true` recebeu o evento, mas não há compromisso de API pública estável. `rawResponseItem/completed` exibiu mensagens de developer/user no probe; esses conteúdos não são armazenados nos artifacts da fixture. Metadata por item não prova que o conjunto completo corresponde ao histórico enviado em cada request.

## EXEC VS APP-SERVER

O runner separado é [`scripts/wayper-harness-provider-telemetry-experiment.mjs`](../../../../scripts/wayper-harness-provider-telemetry-experiment.mjs). O runner `codex exec --json` existente permaneceu intacto. O experimento usa o mesmo `prepareBlindWorkspace`, `blindInvocation`, binary 0.155.1, bwrap, checkout congelado, Goal, prompt, model `gpt-6-sol`, effort `high`, `workspace-write`, output schema e timeout de 480 s. `thread/start.ephemeral=true` corresponde ao `exec --ephemeral`; HOME mascarada contém auth e nenhum `config.toml` do usuário. O app-server não oferece um flag `--ignore-user-config` análogo; a ausência de config na HOME mascarada reduz, mas não prova, equivalência de inicialização.

Artifact da fixture: `.wayper-context/benchmark-runs/provider-telemetry/2026-09-25T13-45-51-861Z-9418/`. SHA do runner no checkpoint: `3b929be0f4e999ab1f605524eef95ed181943362c63e2ba1adb428371f90249c`. Ordem: T1 exec/app, T2 app/exec, T3 exec/app. Em todos os seis: mesmo SHA V1, prompt e schema, mesmo manifesto de **520 arquivos** no workspace cego, resultado `COMPLETE` com `42`, uma tool shell e diff de zero bytes. GroundTruth, suite e telemetry não estavam na projeção. A saída estruturada do app veio do item final; a do exec veio de `--output-last-message`.

| Trial | Transport | Responses observadas | Input / cached | Tool output observado | Wall time | Resultado |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| T1 | exec | UNKNOWN | 40,081 / 14,464 | 75,465 B | 21.9 s | COMPLETE, sem diff |
| T1 | app | 2 | 41,805 / 15,104 | 75,818 B | 25.0 s | COMPLETE, sem diff |
| T2 | app | 2 | 41,275 / 0 | 75,689 B | 29.5 s | COMPLETE, sem diff |
| T2 | exec | UNKNOWN | 40,311 / 14,464 | 0 B em `aggregated_output` | 21.3 s | COMPLETE, sem diff |
| T3 | exec | UNKNOWN | 39,983 / 14,464 | 75,794 B | 22.3 s | COMPLETE, sem diff |
| T3 | app | 2 | 41,377 / 15,104 | 66,134 B | 24.0 s | COMPLETE, sem diff |

O `aggregated_output=0` no T2/exec é apenas o campo JSONL observado. Não conclui que o modelo não recebeu saída de tool. Os comandos diferiram: app T1/T2 leu os documentos da raiz e a skill por script Python; app T3 não leu a skill, resultando em cerca de 9 KB a menos de saída. Exec T1/T3 leu a skill; T2 também a invocou no comando, mas o campo de saída veio vazio. Tais trajetórias podem variar sem mudança de transporte; a fixture não isola causalmente a diferença. Para esta investigação, a diferença de leitura é material porque altera o próprio contexto que se quer medir. Token count diferente por si só não determinou o gate.

## OBSERVER EFFECT

Mudaram o cliente (`clientInfo` e originator), handshake, criação de thread/turn, `experimentalRawEvents`, a forma de entregar schema e a forma de persistir resultado. O app foi iniciado com `-c model_reasoning_effort="high"`, enquanto exec recebeu o mesmo effort no argumento `-c`; ambos também receberam model/effort no começo do turn ou flags correspondentes. O app usa `turn/start.outputSchema`; exec usa o arquivo de schema. Os dados medidos ficaram fora do workspace candidate; o prompt e os 520 arquivos projetados foram idênticos, mas o conteúdo integral de instruções internas e tool definitions por model request **não** pôde ser comparado. Os itens brutos do app mostraram mensagens de developer/user, mas não há stream análogo no `exec --json` para comparação. Isso é `OBSERVER_EFFECT_RISK`.

## RESPONSE TRACE, TOKEN GROWTH, TOOL CORRELATION, CACHE BEHAVIOR

Somente da **fixture neutra**, não H10/H11. Em cada trial app, response 1 precedeu a tool e response 2 veio depois dela:

| Trial app | Response | Input | Cached | Fresh | Delta input | Tool output desde anterior | Cached ratio |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| T1 | 1 | 15,263 | 0 | 15,263 | UNKNOWN | 0 B | 0% |
| T1 | 2 | 26,542 | 15,104 | 11,438 | +11,279 | 75,818 B | 56.9% |
| T2 | 1 | 15,263 | 0 | 15,263 | UNKNOWN | 0 B | 0% |
| T2 | 2 | 26,012 | 0 | 26,012 | +10,749 | 75,689 B | 0% |
| T3 | 1 | 15,263 | 0 | 15,263 | UNKNOWN | 0 B | 0% |
| T3 | 2 | 26,114 | 15,104 | 11,010 | +10,851 | 66,134 B | 57.8% |

T1/T3 cached cresceu +15,104; T2 permaneceu zero apesar de volume semelhante de input e de uma tool. Isso demonstra variação de contabilidade de cache nesta fixture, sem provar mecanismo, causa ou bug do provider. O salto entre responses veio após uma leitura grande em todos os trials app. A granularidade permite localizar saltos, não atribuir todo o input posterior ao output da tool. `timestampStart` da response e provider request ID continuam `UNKNOWN`; `timestampEnd` é hora de recebimento local do evento. Nenhum evento de compaction foi recebido; a ocorrência interna permanece `UNKNOWN`.

## V1 VS V2 / ROOT CAUSE / FINAL CLASSIFICATION

H10/H11 e V2 **não foram executados** nesta fase. Portanto responses, input/cached/fresh growth, wall time e tools por candidate são `UNKNOWN` nesta bateria. Não há evidência nova que atribua os outliers H10/H11 a Context Packet, reinjeção, Feedback, Completion, retries ou qualquer componente project-owned. Também não há base para atribuir a causa desses outliers ao provider. `FINAL_CLASSIFICATION = STILL_UNOBSERVABLE` para a pergunta central de H10/H11.

## NEXT ACTION

`TRANSPORT_LIMITATION`: obter equivalência observável suficiente de instruções/tool definitions e comportamento de leitura, ou uma fonte de usage por response no próprio `codex exec`, antes de repetir H10/H11. Nenhum tuning ou replay adicional foi feito. Rollback da infraestrutura: reverter apenas o commit experimental; os artifacts diagnósticos podem ser removidos separadamente sem tocar os resultados históricos.

Validação executada: PTEL1–PTEL15 `15/15`, `node --check`, `git diff --check`, fixture 3 exec + 3 app. Comando do teste: `node scripts/quality/check-provider-telemetry.test.mjs --run=.wayper-context/benchmark-runs/provider-telemetry/2026-09-25T13-45-51-861Z-9418`. O primeiro uso com `node --test ... --run=...` não repassou o argumento customizado e falhou por ausência de artifact; a invocação direta acima passou.

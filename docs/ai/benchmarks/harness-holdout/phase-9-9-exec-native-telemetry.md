# Fase 9.9 — telemetria por response no `codex exec`

Data: 2026-09-25/26. Diagnóstico separado do holdout. Run local:
`.wayper-context/benchmark-runs/exec-native-telemetry/2026-09-26T01-09-19-658Z-50748/`.
Candidates congelados: V1 `2db95d40567564cf3bb6727096b81d448b1dd765`, V2
`7adb4f1e7970ff79a0848c763207109416c6db1d`; modelo `gpt-6-sol`/`high`;
CLI `0.155.1`. `suite.json`, freeze, scorer, GroundTruth, holdout e resultados
históricos não foram alterados.

## VERDICT

| Campo | Resultado | Evidência/limite |
| --- | --- | --- |
| exec telemetry | **PARTIAL** | Tap da build instrumentada recebeu usage por response em 3/3 fixture trials e reconciliou quatro campos; neutralidade comportamental não foi demonstrada. |
| equivalence | **INCONCLUSIVE** | Seis resultados funcionais corretos, mas comandos e leituras variaram materialmente entre e dentro dos grupos. Não há atribuição causal ao tap. |
| diagnosis | **STILL_UNOBSERVABLE** | Gate não passou; H10/H11 não foram executados. |
| final classification | **STILL_UNOBSERVABLE** | Não há trace equivalente dos outliers H10/H11. |
| next action | **STOP_INVESTIGATION** | Não aplicar tuning/fix nem iniciar outro transporte nesta fase. |

O checkpoint conserva `status=TRANSPORT_NOT_EQUIVALENT` como rótulo do runner
experimental, mas seu campo decisório é `equivalence=INCONCLUSIVE`. O transporte
usado nos seis trials foi `codex exec`; o rótulo de status não demonstra uma
troca de transporte.

## EXEC INTERNAL PATH

Source exato: tag [`rust-v0.155.1`](https://github.com/openai/codex/tree/rust-v0.155.1),
commit `be2951ea34f0d295ed0becf97079f92fa5f6950e`.

```text
Responses API stream
  -> core ResponseEvent::Completed (session/turn.rs:2781)
  -> record_observed_response_completed (session/mod.rs:4518)
  -> EventMsg::RawResponseCompleted(response_id, token_usage)
  -> app-server embutido: thread_lifecycle.rs:329-338
     descarta o raw event se experimental_raw_events=false
  -> InProcessAppServerClient do exec (exec/lib.rs:973)
  -> should_process_notification (exec/lib.rs:1577)
  -> EventProcessorWithJsonOutput (exec/event_processor_with_jsonl_output.rs)
  -> stdout JSONL

Em paralelo: core TokenCount -> ThreadTokenUsageUpdated ->
last_total_token_usage -> turn.completed.usage no stdout JSONL.
```

O `exec` cria a thread com `ThreadStartParams::default()`, portanto
`experimental_raw_events=false` (`exec/lib.rs:1344-1370`). O primeiro descarte
da granularidade ocorre **antes** do cliente in-process do `exec`, em
`app-server/src/request_processors/thread_lifecycle.rs:329-338`; o adapter JSONL
também não mapeia `RawResponseCompleted`. O total do turn vem de
`ThreadTokenUsageUpdated` (`event_processor_with_jsonl_output.rs:502-528`).
Não há evento por response no stdout original.

Opções A/B/C: o source/CLI 0.155.1 não mostram flag de `exec --json` que exponha
raw usage sem mudar `thread/start`; os hooks disponíveis não entregam usage por
response; um tap no adapter `exec` chega depois do filtro. Ativar
`experimental_raw_events` mudaria o handshake. **Opção D** foi usada: build
local da tag exata com um patch observacional no core.

## OBSERVER IMPLEMENTATION

Patch: `scripts/wayper-codex-0.155.1-exec-response.patch` (22 linhas adicionadas
em `core/src/session/mod.rs`; representação sem contexto). Antes do `send_event`, escreve uma linha marcada
no stderr com `threadId`, `turnId`, `responseId`, uso recebido, janela de
contexto e timestamp; também marca início/fim de item de compaction. Não altera
request, prompt, tools, sandbox, approval, sessão, retry, cache, compaction ou
provider. O runner `scripts/wayper-harness-exec-native-telemetry.mjs` troca só
o arquivo montado em `/tmp/codex`, filtra essas linhas do stderr do attempt e
grava `observer-timeline.json`/`response-trace.json` fora do candidate, em
`observer-attempt-N/`. `stdout.log` conserva o JSONL original. Não há nova
mensagem ou tool call do candidate.

Build: `cargo build --offline --release -p codex-cli --bin codex` com Rust
1.95.0; source da tag acima. O `Cargo.lock` do checkout temporário atualizou
somente versões de pacotes internos do workspace (`0.0.0` para `0.155.1`), sem
alteração em dependências externas. Original: musl, SHA-256
`0753dfe1d8b87a52436deb13eb1c549661ef4c84fee2c5aa688385eebeccb761`.
Instrumentado local: glibc, SHA-256
`ba14cbf08cb006e75f9a1c85e39619b33b7f365121262c93bcbe3b394125a30a`.
Patch usado na fixture: SHA-256
`17d4259788280e7fb6cdda7de9490f15c328c12ba5032b409b91930e47022672`.
O mesmo patch, reformatado sem linhas de contexto em 2026-09-28 para passar no
quality hook, tem SHA-256
`e2cc3f36c92f43b5de605c66fc8000401e16bf4ecc65da52efb3e2cd8aaaa052`.
O original está preservado em
`.wayper-context/phase-9-9-recovery/patch.original.patch`; o checkpoint da
fixture conserva seu hash original. O novo patch exige
`git apply --unidiff-zero`; `git apply` sem essa opção pode inserir as linhas
no fim do arquivo e **não** é uma aplicação válida.

Prova da reformatação: a cópia limpa de `codex-rs/core/src/session/mod.rs`
obtida do commit `be2951e` teve Git blob
`98bfa792b2843b940e2aecadea54f1b80df0d199`. O patch original passou
`git apply --check`; o reformatado passou `git apply --unidiff-zero --check`.
Aplicados separadamente nessa mesma base, os dois produziram o mesmo arquivo
(SHA-256 `a14afb564b22ba1bd32a0e87ce89382cc6432fa6d5778fb8cf95f9adba18d8dd`,
Git blob `e149dd5461d732f3a3a3c0f801b09bae2a8214ec`) e diffs sem contexto
idênticos byte a byte (SHA-256
`e2cc3f36c92f43b5de605c66fc8000401e16bf4ecc65da52efb3e2cd8aaaa052`).
A reformatação não muda a build nem reabre o gate de equivalência.
A diferença de target de build reforça que equivalência não pode ser presumida.
O tap faz escrita síncrona curta no stderr; seu efeito temporal exato não foi
medido isoladamente.

## EQUIVALENCE PROOF — FIXTURE 3 ORIGINAL × 3 INSTRUMENTADO

Ordem alternada: T1 original/instrumentado, T2 instrumentado/original, T3
original/instrumentado. Em todos: V1 SHA congelado, mesmo Goal/prompt (SHA-256
`59dfdc61bcc91a49244284976234dbbaf5392bd105c099725e621b963cebf519`),
mesmos argumentos `exec --ignore-user-config --ephemeral --json`, modelo,
effort, `workspace-write`, schema, `bwrap`, sidecar, environment overrides e
manifesto de 520 arquivos projetados. `exec --help` e `features list` foram
idênticos entre binários; contratos do observer também foram idênticos.
GroundTruth e artifacts do observer ficaram fora da projeção.

| Trial | Binário | Comandos concluídos | Turn input / cached | Responses vistas | Saída / exit / diff |
| --- | --- | ---: | ---: | ---: | --- |
| T1 | original | 5 | 91.905 / 65.280 | UNKNOWN | `42` / 0 / 0 B |
| T1 | instrumentado | 9 | 86.647 / 60.672 | 4 | `42` / 0 / 0 B |
| T2 | instrumentado | 5 | 64.772 / 39.168 | 3 | `42` / 0 / 0 B |
| T2 | original | 6 | 119.173 / 91.904 | UNKNOWN | `42` / 0 / 0 B |
| T3 | original | 7 | 92.380 / 65.536 | UNKNOWN | `42` / 0 / 0 B |
| T3 | instrumentado | 7 | 98.560 / 89.984 | 5 | `42` / 0 / 0 B |

As sequências não coincidiram: T1 instrumentado tentou uma skill por caminho
inexistente e fez leituras extras de documentos; T3 original leu
`docs/00-fontes-do-projeto.md` e `docs/ai/context-routing.md` integralmente,
enquanto T3 instrumentado leu trechos. Comandos/leituras também variaram entre
os três **originais**. A fixture prova mesmo material disponível e resultado
funcional, mas não prova mesma trajetória ou os mesmos bytes efetivamente
reinjetados no modelo. Não é possível isolar causalmente o tap dessas variações.
Por isso `INCONCLUSIVE`, com parada antes de H10/H11; tampouco há evidência para
atribuir uma `MATERIAL_DIFFERENCE` ao observer.

## USAGE RECONCILIATION E CACHE GROWTH — SOMENTE FIXTURE

O trace é por attempt, com sequence 1-based; `UNKNOWN` permanece literal para
request ID, início da response e campos ausentes. `fresh = input - cached`
somente quando ambos foram observados. Janela informada em todos os responses:
258.400 tokens. Os números abaixo são **fixture V1**, não H10/H11.

| Trial/response | Input | Cached | Fresh | Output | Reasoning | Tools desde anterior | Output de tools observado |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| T1/R1 | 14.694 | 0 | 14.694 | 294 | 53 | 0 | 0 B |
| T1/R2 | 21.488 | 14.464 | 7.024 | 339 | 92 | 4 | 66.136 B |
| T1/R3 | 25.044 | 21.376 | 3.668 | 256 | 69 | 3 | 12.070 B |
| T1/R4 | 25.421 | 24.832 | 589 | 104 | 26 | 2 | 22 B |
| T2/R1 | 14.694 | 0 | 14.694 | 250 | 42 | 0 | 0 B |
| T2/R2 | 24.852 | 14.464 | 10.388 | 244 | 64 | 3 | 75.509 B |
| T2/R3 | 25.226 | 24.704 | 522 | 95 | 30 | 2 | 55 B |
| T3/R1 | 14.694 | 14.464 | 230 | 234 | 37 | 0 | 0 B |
| T3/R2 | 17.474 | 14.464 | 3.010 | 267 | 52 | 2 | 9.856 B |
| T3/R3 | 21.955 | 17.280 | 4.675 | 124 | 39 | 3 | 16.306 B |
| T3/R4 | 22.145 | 21.760 | 385 | 86 | 41 | 1 | 27 B |
| T3/R5 | 22.292 | 22.016 | 276 | 97 | 0 | 1 | 22 B |

Por attempt instrumentado, `sum(response)` igualou `turn.completed.usage` em
**input, cached, output e reasoning: EXACT_MATCH 12/12 comparações**. Os
originais não têm response sums (`UNKNOWN`), embora emitam turn totals. O
comportamento da Fase 9.8 (`response 2 cached = 15.104 / 0 / 15.104`) **não se
repetiu literalmente**: nesta fixture exec-native R2 cached foi 14.464 nos
três trials. Houve outra variância de cache: T3/R1 já tinha 14.464 cached,
enquanto T1/R1 e T2/R1 tinham zero. Não há prova de causa ou de equivalência
numérica com o app-server.

Tools são correlacionadas por ordem local de recebimento dos pipes stdout e
stderr; essa ordem não é um relógio causal único. Grandes saídas documentais
apareceram antes do crescimento de input em T1/T2, mas a correlação não prova
reinjeção integral nem causa do salto. **Compaction observada: zero eventos**
nos três instrumentados; compaction interna não emitida continua `UNKNOWN`.

## H10, H11 E HIPÓTESES

H10: **NOT_RUN** — responses, usage, cache, tools e compaction por attempt
`UNKNOWN`. H11: **NOT_RUN** — mesmos campos `UNKNOWN`. Total diagnóstico
H10/H11: **0/12**, por falha do gate. Nenhum registro foi combinado ao holdout.

| Hipótese | Classificação | Limite |
| --- | --- | --- |
| A Mais responses no trial caro | UNKNOWN | Não há response trace de H10/H11. |
| B Histórico cresce por response | PARTIAL | Input cresce na fixture; histórico enviado por request é desconhecido. |
| C Cached cresce progressivamente | PARTIAL | Ocorre em trechos da fixture, com R1 de T3 já cached. |
| D Um salto isolado domina | UNKNOWN | Fixture não reproduz os outliers H10/H11. |
| E Tool output antecede o salto | PARTIAL | Ordem local da fixture; causalidade/reinjeção desconhecida. |
| F Leitura integral antecede o salto | PARTIAL | Leituras integrais ocorreram na fixture, sem equivalência de trajetória. |
| G Compaction altera trajetória | UNKNOWN | Nenhum evento observado na fixture; H10/H11 não rodaram. |
| H V2 aciona mecanismo adicional | UNKNOWN | V2 não rodou nesta fase. |
| I V1 apresenta mesma variância | PARTIAL | Usage/comandos variaram na fixture V1; H10/H11 V1 desconhecidos. |
| J Provider/model trajectory explica melhor | UNKNOWN | Não há isolamento causal de provider versus observer. |

**ROOT CAUSE: não identificada.** Nem `HARNESS_CONTEXT_GROWTH` nem
`PROVIDER/MODEL VARIANCE` satisfazem os critérios causais pedidos. O fenômeno
diagnosticado em H10/H11 permanece `STILL_UNOBSERVABLE` com o gate atual.

## TESTES, LIMITES E ROLLBACK

`node scripts/quality/check-exec-native-telemetry.test.mjs --run=<run-dir>`:
ET1–ET15 **15/15 PASS**. `node --check` dos dois scripts, `git diff --check` e
o check dos quatro arquivos novos com `git diff --no-index --check` passaram.
`npm run quality:benchmark` passou 47/47 testes e `quality:gate` retornou
`PASS_WITH_DEBT` (0 erros de lint, 0 regressões de tamanho/arquitetura).
Uma tentativa anterior do hook em sandbox restrito retornou
`TOOLING_ERROR: spawnSync git EPERM`; isso não valida o hook naquele ambiente.
ET11 valida equivalência funcional (`42`, exit 0, diff 0 B), não
trajetória. ET9/ET8 são verificações sintéticas de parser; quota/retry reais
não ocorreram. ET14/ET15 validam projeção/prompt/artefatos, não o conteúdo
interno de cada request. A build foi desativável simplesmente usando o
binário original; nos três trials originais não apareceu o marcador.

O gate que tornaria a implementação válida para H10/H11 não passou. Para
rollback do experimento local, deixar de usar o binário instrumentado e o
runner; os artifacts em `.wayper-context/` são externos aos candidates.
Nenhum próximo fix foi implementado.

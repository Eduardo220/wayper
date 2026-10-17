# BENCHMARK_REGRESSION — diagnóstico e correção

Data: 2026-10-12. Branch: `develop`. HEAD inspecionado:
`694675317e971759fa7f59c54163c3c8f65e9da5`.

## 1. Veredito

Erro na seleção de candidato **nos testes positivos da infraestrutura**.
O validador estava correto ao rejeitar um produto diferente. A suíte congelada
não está desatualizada para seu experimento histórico. Evolução do app não é
autorização para rebaseline. A correção fixa a fixture positiva em um candidato
tuned já avaliado e mantém uma prova negativa de diferença real de produto.

## 2. Contrato atual do benchmark

Owners: `scripts/wayper-harness-benchmark.mjs` (`readProfileSuite`,
`productFingerprint`, `validateSuite`, `suiteFingerprint`, `validateResult`),
`scripts/wayper-harness-benchmark-agentic.mjs` (`runAgentic`, `singleTrial`),
e [profiles.md](../ai/benchmarks/harness-v1-v2/profiles.md).

Um candidato é um checkout Git isolado de SHA exato. V1 histórico é
`2db95d40567564cf3bb6727096b81d448b1dd765`; V2 baseline é
`4f429df02caf91b5b15dd6826df28c93a50acdfd`. A suíte congela candidatos, corpus
(A=24, B=12, C=23), GroundTruth, scoring, budgets e execução Astra/xhigh/CLI
0.154.0. Operational mantém os SHAs/corpus e deriva Sol/high/CLI instalado.
Operational-tuned mantém V1 e substitui somente V2 pelo SHA completo explícito.
V1 precisa ser ancestral de V2; os dois produtos precisam ser idênticos.

`productFingerprint` aplica o helper `digest` ao texto integral de
`git ls-tree -r --full-tree <sha> -- App.js index.js app.json android src tests`.
Inclui paths, modos, tipos e IDs dos objetos. Para strings, `digest` usa SHA-256
dos bytes; para objetos, serializa chaves em ordem. Nada consulta WIP/untracked.
Testes e diagnósticos de produto são relevantes e permanecem no fingerprint.

O suite fingerprint cobre a definição inteira sem seu próprio campo
`fingerprint`, incluindo candidatos, GroundTruth, scoring e model/runtime.
O result fingerprint cobre o resultado inteiro sem seu próprio fingerprint.
`validateResult` exige suite fingerprint, SHA do candidato e identidade de
execução exatos. Checkpoints de resume exigem suite/profile/trial filter iguais;
`singleTrial` verifica o HEAD do worktree contra o SHA selecionado.

## 3. Três testes que falhavam

Em `scripts/quality/check-harness-benchmark.test.mjs`, antes da correção:

1. L58: `PT benchmark tuned profile freezes one V2 SHA and rejects baseline reuse`.
2. L71: `PT tuned runner executes V2 only and checkpoints the candidate fingerprint`.
3. L93: `surgical trial filter runs exactly one requested repetition`.

Reprodução observada: 26 testes, 23 PASS, 3 FAIL, todos com
`product source differs`, exit 1. O terceiro foi introduzido em `7adb4f1`;
os primeiros dois e o uso de `git rev-parse HEAD` vieram de `cb33e30`.

## 4. Por que HEAD diverge

Os únicos commits que alteram os paths de produto entre V2 baseline e HEAD são:

- `88601da8b38dfe2815fc94eed1af083518ce23c0`: Flight Recorder, replay headless
  e correções da duração final.
- `694675317e971759fa7f59c54163c3c8f65e9da5`: tracking desacoplado de MapScreen.

`HEAD` funcionava como fixture no momento do tuning, quando esses commits ainda
não existiam. Os callers reais recebem `--tuned-sha`; não selecionam HEAD
automaticamente. `identityEvidence` do V2 registra HEAD **no freeze**, não uma
obrigação de comparar todo HEAD futuro com esse produto histórico.

| Árvore | Product fingerprint |
| --- | --- |
| V1, V2 baseline, `cb33e300…`, `7adb4f1` | `sha256:68a2e333f9d1c7354eb0180ad5d5d5d837cbc4d9352b611753bfbd7f5d334dea` |
| `88601da8…` | `sha256:4ed01d880885402c2649f553b82d5fecc6871fbb37e9a3942e983ad792f83550` |
| HEAD `69467531…` | `sha256:b26d774345aace239b2eff5cb73bb4da70117368dce0ea4d99be7bdc7aa0b853` |

Suite fingerprint histórico:
`sha256:2f1601631dc6f306340275839151b23752824464b26e677fcae02271ed006e2f`.
SHA-256 dos bytes de `suite.json`:
`445af6fecdcedf42986caad0e469f1ca38f6ec3c2155519ac0da9458563b59b9`.

## 5. Diferenças de produto encontradas

Diff Git observado: 23 arquivos, 1162 inserções e 73 remoções. Todos são
**mudança legítima já incorporada ao produto**, no sentido de evolução explícita
em commits, source, documentação e testes coerentes com sua finalidade.
Isso não certifica ausência de bugs de runtime nem valida a corrida longa.
Nenhuma diferença foi provada como regressão funcional nesta investigação.
Nenhum arquivo foi considerado irrelevante ou excluído do fingerprint.

Na tabela, D = `88601da` e L = `6946753`.

| Arquivo | Origem | Diferença/classificação |
| --- | --- | --- |
| `App.js` | L | Coordenador foreground, AppState/checkpoint e reconcile no bootstrap; evolução incorporada. |
| `src/hooks/__tests__/mapScreenBlockers.test.js` | L | Testa unmount sem parar tracking; evolução incorporada. |
| `src/hooks/runStartExecutor.js` | D | Eventos de GPS inicial; evolução incorporada. |
| `src/hooks/useMapScreenLifecycle.js` | L | Remove parada do watcher/checkpoint que passam ao owner externo; evolução incorporada. |
| `src/hooks/useRunLocationResources.js` | L | Sincroniza owner canônico, remove lifecycle do watcher da UI; evolução incorporada. |
| `src/navigation/__tests__/rootNavigation.test.js` | L | Cobertura da navegação sem ownership de tracking; evolução incorporada. |
| `src/screens/DiagnosticsScreen.js` | D | Exportação do Flight Recorder; evolução incorporada. |
| `src/services/diagnostics/__tests__/activeRunFlightRecorder.test.js` | D | Privacidade, falhas, append e retenção; evolução incorporada. |
| `src/services/diagnostics/activeRunFlightRecorder.js` | D | Novo recorder local e exportação; evolução incorporada. |
| `src/services/diagnostics/diagnosticExportService.js` | D | Inclui recorder nos exports; evolução incorporada. |
| `src/services/diagnostics/logStorageService.js` | D | Exporta helpers reutilizados pelo recorder; evolução incorporada. |
| `src/services/run/__tests__/activeRunLocalFirst.integration.test.js` | D | Timeline/duração preservada na finalização local; evolução incorporada. |
| `src/services/run/__tests__/runFinalizationService.test.js` | D | Duração canônica, pausas e timestamps inválidos; evolução incorporada. |
| `src/services/run/runAutoSaveService.js` | D | Eventos dos checkpoints de compatibilidade; evolução incorporada. |
| `src/services/run/runFinalizationService.js` | D | Prioriza timeline canônica válida, corrige parsing e aliases de pausas; evolução incorporada. |
| `src/services/runTracking/__tests__/activeRunForegroundWatcher.test.js` | L | Startup/cancelamento/ownership do watcher; evolução incorporada. |
| `src/services/runTracking/__tests__/activeRunLifecycleContract.test.js` | D | Atualiza contrato da task instrumentada; evolução incorporada. |
| `src/services/runTracking/__tests__/activeRunState.test.js` | D | Duração/timeline final; evolução incorporada. |
| `src/services/runTracking/__tests__/activeRunTrackingService.test.js` | D/L | Replay headless e tracking sem MapScreen; evolução incorporada. |
| `src/services/runTracking/activeRunForegroundWatcher.js` | D/L | Recorder e coordenador por snapshot canônico; evolução incorporada. |
| `src/services/runTracking/activeRunRuntimeService.js` | D | Evento de recuperação; evolução incorporada. |
| `src/services/runTracking/activeRunTrackingService.js` | D | Recorder, checkpoints e supressão de replay; evolução incorporada. |
| `src/tasks/activeRunLocationTask.js` | D | Flush diagnóstico limitado após processamento canônico; evolução incorporada. |

`index.js`, `app.json`, `android/` e `tests/` não têm diferenças nessa comparação
de commits. Ranking WIP e observer Android estão fora da causa e da correção.
Os registros de direção relacionados são `docs/diagnostics.md` no commit D e
`docs/wayper/09-arquitetura-tecnica.md` no commit L, corroborados pelos diffs
e pelos testes incorporados nos mesmos commits.

## 6. Causa raiz

A fixture positiva móvel herdou uma premissa não codificada: HEAD só muda
Harness. Quando o produto evoluiu, testes que exigem PASS passaram a construir
uma suíte intencionalmente incompatível. É **erro na seleção do candidato nos
testes**, não erro na equivalência, nem candidato histórico desatualizado.

## 7. Por que validate passa mas o gate falhava

`node scripts/wayper-harness-benchmark.mjs validate` chama `validateSuite()` sem
argumento, validando V1/V2 congelados e equivalentes. O gate executa os testes;
os três construíam `operational-tuned` com HEAD e recebiam a rejeição correta.

`npm run quality:benchmark -- validate` também executa a suíte de infraestrutura;
o argumento adicional não escolhe HEAD. Nesta execução completa passou 48/48
após a correção. Um PASS do validador isolado nunca provou PASS desse conjunto.

## 8. Correção aplicada

Os três testes positivos usam `TUNED_FIXTURE_SHA=cb33e300…`, registrado em
[proportionality-report.md](../ai/benchmarks/harness-v1-v2/proportionality-report.md).
É distinto de V2 baseline e mantém o mesmo produto; nenhuma nova baseline foi
criada. Novo BM3 negativo usa um commit real de produto incompatível.
O contrato foi explicitado em profiles.md. O executor de escrita usou
grant/lease/permit e encerrou as leases; nenhum commit/push.

## 9. Por que não enfraquece a equivalência

Nenhuma alteração em `PRODUCT_PATHS`, `productFingerprint`, `validateSuite`,
runner, seleção CLI, suite.json, GroundTruth, scoring, datasets ou quality:gate.
O código atual do runner/scorer é testado com identidades de candidatos fixas.
HEAD continua aceito quando explicitamente selecionado **e equivalente**;
o HEAD atual continua corretamente rejeitado como candidato desse experimento.

## 10. Teste de regressão real

`BM3 tuned validation rejects real committed product drift before trials or artifacts`:
confirma fingerprints distintos de `88601da8…` e V1, exige que `validateSuite`
lance `product source differs`, exige rejeição de `runAgentic`, impede chamada
do trialRunner e verifica que nenhum artifact/checkpoint foi criado.
Essa prova usa mudanças reais de código commitado, sem fingerprint inventado.
Se a comparação for removida/relaxada, a expectativa de rejeição falha no gate.

## 11. Arquivos alterados

- `scripts/quality/check-harness-benchmark.test.mjs`.
- `docs/ai/benchmarks/harness-v1-v2/profiles.md`.
- `docs/audits/2026-10-12-benchmark-regression.md` (este relatório).

Runtime/receipts desta Goal ficam em `.wayper-context/`; não alteram a
investigação de corrida longa nem os contextos das outras Goals.

## 12. Quality gates

Execuções obrigatórias: testes direcionados, `quality:benchmark -- validate`,
validador isolado, `quality:gate -- --details`, `quality:architecture`,
`quality:size`, `quality:context` e `git diff --check`.
Os resultados finais e receipts observados ficam no ledger local
`.wayper-context/benchmark-regression/validation.json`, vinculado à execução
`gr-b4a34f92-0520-418e-b015-33436b6c5f7c.r1`. Este documento não substitui
receipts nem a avaliação canônica de Completion.

## 13. BENCHMARK_REGRESSION resolvido?

A reprodução direcionada mudou de 23 PASS/3 FAIL para **27 PASS/0 FAIL**,
incluindo a rejeição de produto real diferente. O estado global depende dos
resultados finais do ledger e de Completion; não se transfere para outra Goal.

## 14. Riscos restantes

Clones shallow precisam disponibilizar os commits congelados e as duas fixtures;
ausência de commit falha fechada. Não se executaram novos trials agentic caros,
benchmark de desempenho do modelo, build ou prova física do app. As diferenças
de produto foram classificadas para a causalidade do benchmark, sem auditoria
funcional completa. O session file protegido tem blocker de whitespace separado
registrado na Goal anterior; este escopo não autoriza alterá-lo.

Rollback: reverter somente o diff destes dois arquivos e remover este relatório
novo, preservando todo o WIP anterior. Isso restabelece os três falsos failures;
não há dados de produto ou datasets migrados para desfazer.

## 15. Próximo passo para retomar a Parte 2 formal

Reobservar o quality gate e reavaliar a Goal dona da Parte 2 com seu seletor
atual, mantendo baseline, receipts físicos e demais blockers. Não editar seu
contexto nesta Goal. Resolver separadamente o session protegido e as obrigações
físicas/local-runtime ainda exigidas. Benchmark verde não prova Parte 2 PASS,
não libera Parte 3 e não fabrica nova evidência Android.

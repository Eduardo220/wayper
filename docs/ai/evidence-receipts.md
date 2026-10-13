# Evidence Receipts V1 — Harness V2 Fase 2

> **Status:** vigente<br>
> **Owner:** [Harness](harness-v1.md)<br>
> **Lifecycle:** [Working Context](working-context.md), schema 2

## Semântica

| Conceito | Significado |
| --- | --- |
| ASSERTION | Declaração de agente, specialist, humano ou legado; não comprova execução. |
| OBSERVATION | Leitura de conteúdo ou execução capturada pela infraestrutura project-owned. |
| RECEIPT | Registro V1 fechado, com identidade, baseline, subject, resultado e provenance. Pode conter uma assertion. |
| VERIFIED RECEIPT | Receipt encontrado no store desta execução, íntegro, atual, com origem observada e pais válidos. |
| STALE RECEIPT | Registro histórico cuja observação já não serve como evidência atual. Seus bytes permanecem imutáveis. |

`claim != evidence`. `PASS`, `verified`, `all tests passed`, `FAIL not validated`,
paths soltos e comandos escritos em prosa não satisfazem requisitos materiais.
Mesmo um receipt VERIFIED pode registrar FAIL; somente um resultado compatível
com o requisito pode satisfazê-lo. SOURCE observado não prova correctness.

## Fluxo e ownership

```text
Goal Identity: threadId + goalRunId + revision + immutable baseline
    |
Working Context schema 2 (owner único)
    |-- observeFile -> SOURCE / DOCUMENT
    |-- runObservedCommand -> COMMAND
    |      `-- runObservedTest / runObservedQualityGate -> TEST / QUALITY_GATE
    |-- recordAssertion -> UNVERIFIED
    `-- recordGraphReference -> cache reference, UNVERIFIED or STALE
           |
    .wayper-context/evidence/<goalRunId>/r<revision>/ER-<sha256>.json
           |
    validateReceipt -> integrity / identity / baseline / source / parents
           |
    evaluateEvidenceRequirement -> SATISFIED or UNSATISFIED with reasons
           |
    Context Map.evidenceReceipts (bounded index)
           |
    Context Packet.evidenceReceiptIds (selected repository/subject only)
           |
    Structured Handoff.existingEvidenceReceiptIds + asserted candidates
           |
    CONTEXT_MAP_OWNER_REVIEW_REQUIRED -> new observation when needed
```

O evaluator Meta Goal usa a mesma API de aceitação. Não está conectado ao Goal
host. O [Validation Planner V1](validation-planner.md), implementado na Fase 3,
consome estes contratos sem executar checks automaticamente. Completion Boundary
e Feedback continuam futuros.

## Contrato fechado

O schema executável é `scripts/wayper-evidence-receipts.mjs`, versão 1.
Objetos e observations rejeitam campos desconhecidos; payload máximo: 12 KiB.

| Campo | Contrato |
| --- | --- |
| `schemaVersion` | `1` |
| `receiptId` | `ER-` + SHA-256 canônico do conteúdo, sem os dois campos de hash |
| `goalReference` | Identity V1 da Fase 1: schemaVersion, threadId, goalRunId, revision |
| `baselineReference` | Fingerprint da baseline multi-repo e fingerprint inicial do repo |
| `repositoryReference` | Snapshot observado: repositoryId, checkoutFingerprint, branch, HEAD, dirty, contentFingerprint |
| `kind`, `origin` | Enums abaixo; combinações inválidas são rejeitadas |
| `subject` | path/range opcionais, target, fingerprint do conteúdo ou estado testado |
| `observation` | Union fechada: FILE, EXECUTION, DERIVATION, ASSERTION, GRAPH_REFERENCE, GRAPH_QUERY_EXECUTION, ANDROID_ARTIFACTS |
| `result` | OBSERVED, PASS, FAIL ou UNKNOWN, condicionado ao tipo de observation |
| `producedAt`, `producer` | Timestamp ISO, nome/version do produtor |
| `contentFingerprint` | SHA-256 do conteúdo canônico; keys ordenadas recursivamente, arrays preservados |
| `parentReceiptIds` | Referências à mesma execução/revisão e repo; até 64 |
| `metadata` | Somente taskId, attemptId, failureId opcionais e bounded; sem lógica de retries |

Kinds: `SOURCE`, `DOCUMENT`, `COMMAND`, `TEST`, `QUALITY_GATE`, `RUNTIME`,
`GRAPH`, `REVIEW`, `HUMAN_DECISION`.

Origins: `SOURCE_OBSERVED`, `RUNNER_OBSERVED`, `HOST_OBSERVED`,
`HANDOFF_ASSERTED`, `MODEL_ASSERTED`, `HUMAN_ASSERTED`, `IMPORTED_LEGACY`.
HOST_OBSERVED permanece reservado. O adapter Android abaixo usa RUNNER_OBSERVED;
a schema não permite usar origins para inventar uma execução.

- FILE identifica path, range, bytes e fingerprint. DOCUMENT usa o mesmo
  observer e preserva provenance sem carregar documento para o Map/Packet.
- EXECUTION registra UUID por execução, cwd, comando sanitizado, fingerprint
  do comando completo, início/fim, exit code/signal, hashes e contadores de bytes
  stdout/stderr, fingerprints antes/depois e contagens TAP quando disponíveis.
- DERIVATION referencia o COMMAND observado. Kind, target, executionId, repo,
  estado, resultado e counts precisam corresponder ao pai. Não existe API pública
  para criar TEST apenas fornecendo `result: PASS`.
- RUNTIME pode usar ANDROID_ARTIFACTS observado pelo adapter abaixo. Os demais
  relatos manuais, browser e emulador permanecem UNVERIFIED. REVIEW e HUMAN_DECISION são assertions. HUMAN_DECISION
  registra decisão/constraint; não comprova teste, build ou correctness.
- GRAPH_REFERENCE conserva graph/corpus/query/result fingerprints e freshness.
  A consulta informada não é promovida a execução observada. Cache stale nunca
  vira source authority. Nenhum Graphify rebuild ocorre neste fluxo.
- GRAPH_QUERY_EXECUTION é criado somente pelo broker após uma execução real e
  registra graph/corpus/scope/query/result fingerprints, tempo, exit e bytes.
  Prova a consulta correspondente; não prova correctness do source, runtime ou
  um Context Artifact reutilizado por outro Goal.

## Trust boundaries e limites

O hash prova integridade do receipt, **não autenticidade criptográfica da
execução**. Código project-owned, store local, checkout e policy fornecida pelo
owner são a infraestrutura confiada. Um participante não pode promover uma
assertion pelo API; um processo com acesso de escrita ao código/store pode
forjar arquivos e hashes. Não há assinatura, attestation, sandbox de comandos,
interceptação universal, CAS ou lease.

O runner executa argv sem shell implícito. Ele prova o exit status do comando
selecionado, não a adequação dos testes escolhidos, a sinceridade de um programa
que imprime PASS, nem comportamento físico. Seleção de suite/target continua
responsabilidade explícita do owner. Counts TAP são informações do processo
executado; não ampliam a autoridade do exit status.

```text
Observed Runner -> execução observada -> receipt verificável
Direct shell    -> investigação -> nenhum receipt automático
Specialist      -> assertion -> owner/source/runner validation
```

## Android físico: captura e admissão por artifacts

Owner: `scripts/wayper-evidence-android.mjs`, integrado ao observer/store existentes.
`ANDROID_ARTIFACTS` é uma alternativa fechada da observation V1; receipts antigos
continuam imutáveis. Não existe API que recebe `result: PASS` do participante.

O owner aprova um profile JSON por **path + SHA-256**, na policy do requirement
(`androidProfile`) e nos inputs do Planner. Exemplo mínimo de formato, não prova
de finalização nem profile aprovado para uma investigação:

```json
{
  "schemaVersion": 1,
  "package": "com.wayper.app",
  "apkFingerprint": "sha256:<hash real do APK esperado>",
  "sourceSubjects": [{"path": "<source relevante>", "fingerprint": "sha256:<hash real>"}],
  "steps": [{
    "id": "diagnosis",
    "args": ["exec-out", "run-as", "com.wayper.app", "cat", "files/diagnosis.json"],
    "checks": [
      {"type": "JSON_EQUALS", "pointer": ["status"], "expected": "IDLE"},
      {"type": "JSON_TIMESTAMP_IN_WINDOW", "pointer": ["at"], "expected": null}
    ]
  }]
}
```

`android-begin --serial SERIAL --profile PATH --profile-fingerprint SHA --mutability READ_ONLY`
captura identidade física e APK antes do cenário e retorna `sessionPath`.
Depois da execução real, `android-finish --session PATH --target TARGET` captura
os artifacts, reobserva identidade/APK e calcula os checks. Ambos usam o seletor
`--thread-id`, `--goal-run-id`, `--revision` de `evidence:observe`.
O adapter **somente lê** via ADB; iniciar/finalizar atividade e ações de UI
continuam no runbook/operador. Não instala APK, escreve storage nem executa shell arbitrário.

Allowlist: `adb -s SERIAL get-state`, propriedades de identidade, package/pm path
e leitura do APK, mais steps `exec-out run-as PACKAGE cat RELATIVE_PATH`,
`exec-out cat /sdcard/PATH`, `logcat -d -v threadtime` e `dumpsys activity activities`.
Sem dispositivo autorizado, flag qemu diferente de 0, package inacessível,
APK divergente ou instalação split, o setup falha fechado. Nenhum FAIL vira PASS.

O bundle privado em `.wayper-context/android/<UUID>/` conserva serial, modelo,
fingerprint do Android, package/versionCode/versionName, hash do APK antes/depois,
argv reproduzível, timestamps, exit codes, stdout/stderr e hashes dos artifacts.
O receipt bounded referencia o bundle/profile e seus hashes; o store verifica
novamente os bytes, a sequência de comandos, a identidade e os checks no consumo.
JSON_EQUALS e TEXT_INCLUDES/EXCLUDES não aceitam resultado fornecido pelo agente.
Ao menos um check temporal é obrigatório. NDJSON_EVENT_SEQUENCE exige eventos
ordenados, do mesmo runId, dentro da captura: `expected` contém
`eventKey`, `timeKey`, `runIdKey`, `events`; `pointer` é `[]`. Permite verificar
Flight Recorder/diagnóstico sem incorporar suas coordenadas no receipt/Context Map.

Se finish produziu FAIL por artifact ainda indisponível, uma chamada explícita
com o mesmo sessionPath pode repetir somente as leituras de artifacts e a
identidade final. O producer verifica a captura FAIL íntegra, conserva o begin
observado, Goal/revisão/profile e timestamps originais, e grava a tentativa em
outro diretório. Bundle e receipt anteriores permanecem imutáveis. Não executa
cenários, não troca profile/source e não altera identidade de Goal. Captura PASS
não permite esse retry; adulteração ou mudança de source/profile falha fechado.

`android-verify --bundle PATH --target TARGET` revalida um bundle já capturado;
produz **nova observação** vinculada à identidade/revisão atual e preserva no
bundle a identidade e timestamps originais. Não copia/reassina/rebinda receipts.
Reuse exige profile idêntico, mesmo APK aprovado, artifacts íntegros e todos os
sourceSubjects aprovados inalterados. Mudanças fora desses subjects não reexecutam
prova física. Gate/test receipts de comando mantêm seu contrato de repo inteiro.
Archives anteriores sem esse envelope não ganham proveniência retroativa: podem
ser DOCUMENT/SOURCE/auditoria observada, não uma captura Android fabricada.

A aprovação do profile exige cobertura do claim e de suas dependências. Uma
identidade de APK não prova start/finish/history/deep link. Um export recente não
prova que um cenário antigo foi executado com o APK atual; os checks devem exigir
eventos do cenário dentro da captura. Build/source e bundle Metro continuam
obrigações separadas: SHA do APK não autentica o JS servido por Metro. ADB e store
local são trusted infrastructure, sem attestation contra um host/writer malicioso.
Saídas privadas podem conter GPS/logs: não publicar bundles brutos. Limites atuais:
64 source subjects, 16 steps, 32 checks/step, 128 MiB/output e 60 s/comando; não há
truncamento admitido como PASS, retries ou suporte a split APK nesta versão.

Policy sem `androidProfile` não admite ANDROID_ARTIFACTS, mesmo com target igual.
No Planner, critério Android pode declarar `androidProfile`; o campo opcional no
repo cobre somente cenários Android/shared sem criterionId. L3/L5/L6 mantêm seus
requirements e environments. Sem profile, o observer continua UNAVAILABLE; com
profile aprovado e sem execução, permanece MISSING. Tests/builds não substituem
RUNTIME, e aprovação do profile não satisfaz build, assurances ou quality gates.

Receipts preservam FAIL inclusive em timeout ou executável indisponível. Uma
execução que muda o estado do repo fica stale para prova atual, mesmo com exit
zero. Comandos externos ao runner não são retrospectivamente interceptados.

## Baseline, freshness e persistência

Baseline inicial por revisão nunca é substituída. Receipts incluem também o
estado efetivamente observado, que pode ser dirty. Validação consulta source e
Git atuais; copiar receipt entre Goal/revision/baseline/checkout não é reuse.
Não há política de carry-forward de receipts entre revisões nesta fase.
Amendment parcial preserva discovery, mas exige nova observação material.

SOURCE/DOCUMENT podem continuar válidos após edição fora do range observado,
mantendo HEAD/branch/checkout. COMMAND/TEST/QUALITY_GATE exigem fingerprint do
repo inteiro inalterado, incluindo index e untracked não ignorados. Staging e
commit podem exigir revalidação; receipt anterior continua sendo histórico da
execução anterior à mudança.

Validação retorna status `VALID`, `STALE`, `UNVERIFIED` ou `INVALID`, com motivos
estruturados como WRONG_GOAL, WRONG_REVISION, WRONG_BASELINE, WRONG_REPOSITORY,
INVALID_SCHEMA, INVALID_FINGERPRINT, MISSING_PARENT, INVALID_DERIVATION,
UNRECORDED_RECEIPT, STALE_SUBJECT, STALE_REPOSITORY e UNVERIFIED_ORIGIN.

Persistência pertence ao Working Context, isolada por goalRunId/revision. Cada
receipt tem arquivo individual, write temporário + fsync + publicação atômica
sem substituição. Leitura ordena IDs. Symlinks no store e escapes de path são
rejeitados. Não há bulk migration nem overwrite de receipts históricos.
`.wayper-context/` já é ignorado pelo Git.

Saídas têm política `HASH_ONLY`: nenhum stdout/stderr bruto ou environment
completo é persistido. Argumentos são omitidos do comando apresentado; o hash
preserva a distinção entre execuções. Texto bounded recebe redaction de padrões
sensíveis; `.env`, credentials e private-key paths são recusados pelo file
observer. Redaction por padrão não substitui a responsabilidade do owner por
texto manual; valores secretos arbitrários não possuem detector universal.

## APIs e uso

Fase 7: runners exigem `mutability: READ_ONLY|MUTATING`. UNKNOWN/missing não
executa. MUTATING exige grant/permit consumido pelo [executor governado](dispatch-ownership.md);
o producer reivindica a execução uma vez. Na CLI, declarar `--mutability`; para
mutation também `--grant-id`, `--permit-id` e `--actor-id` do dispatch atual.
Violação observada de READ_ONLY gera erro separado com o receipt de exit code
preservado. Evidence V1 não muda de schema: bindings de dispatch/actor/lease/fence
ficam no resultado persistido do permit, que referencia os receipts observados.

```sh
npm run evidence:observe -- test --thread-id <threadId> \
  --goal-run-id <goalRunId> --revision <N> --target unit --mutability READ_ONLY \
  -- node --test scripts/quality/check-evidence-receipts.test.mjs

npm run context:prove -- --thread-id <threadId> --goal-run-id <goalRunId> \
  --revision <N> --requirement TEST:unit --evidence ER-<sha256>

node scripts/wayper-context.mjs record --thread-id <threadId> \
  --goal-run-id <goalRunId> --revision <N> --kind receipt \
  --data '{"receiptId":"ER-<sha256>"}'
```

Modes do observer CLI: source, document, command, test, gate, android-begin,
android-finish, android-verify. Os helpers também
aceitam `{ root, execution, repositories, repository, ... }`. Store root é o
owner do Working Context; roots operacionais não são expostos no receipt.
No CLI, `--repository-id wayper-site` escolhe o subject repo; as definições
operacionais vêm do Working Context existente.

| API | Consumer futuro |
| --- | --- |
| `observeFile`, `runObservedCommand`, `runObservedTest`, `runObservedQualityGate` | Observação explícita; comandos com contrato de mutabilidade; mutation pelo grant/permit da Fase 7 |
| `readReceipt`, `listReceipts`, `validateReceipt` | Inventário, validade, stale e provenance |
| `evaluateEvidenceRequirement(policy, ids, context)` | Requisito -> receipts aceitos/rejeitados e motivos |
| `validateEvidenceRequirement(policy)` | Validação do contrato fechado de aceitação |
| `inspectEvidenceRequirements(requirements, context)` | Inventário + accepted/missing/stale por requisito |
| `receiptIndexEntry` | View bounded para o Map |
| `recordAssertion`, `recordGraphReference` | Candidatos/documentação de observações limitadas |

Policy é fechada: kinds, repository, result e target ou path/range; fingerprint
opcional fixa o conteúdo esperado. Working Context `SOURCE:path` e
`DOCUMENT:path` pedem OBSERVED; COMMAND/TEST/QUALITY_GATE pedem PASS e target
igual ao ID do requisito. Prefixo `wayper-site:` qualifica o repo. Kinds legados
como SUCCESS/RISK aceitam somente TEST/QUALITY_GATE observado com target exato,
sem inferir correção semântica do texto. Não há capability -> depth/command.

## Compatibilidade e consumers

Working Context schemas 1 e 2 continuam legíveis. Texto legado fica
LEGACY_UNVERIFIED/REVALIDATION_REQUIRED, preservando evidence original. Nenhum
texto sozinho produz SATISFIED ou STOP_WHEN_PROVEN. Map anterior sem receipt
index continua inspecionável; ausência de verification em refs/validações
legadas significa LEGACY_UNVERIFIED, nunca VERIFIED. Esse default é omitido do
Map serializado para preservar o budget. Dependencies e source refs continuam
servindo discovery; receipts não promovem claims dessas entradas.

Map indexa IDs, kind, subject, result, origin, producer, timestamp, relação de
baseline e verification/reasons. Refresh revalida sob chamada. Known-good sem
receipt suficiente tem `verification: KNOWN_GOOD_UNVERIFIED`; scoring do router
não foi corrigido. Gaps materiais exigem `receiptRequirement` e `receiptIds`;
resolver um gap apenas com refs legadas não permite STOP_WHEN_PROVEN.

Packets incluem apenas `evidenceReceiptIds` relevantes ao subject e repo
permitidos, até 64, contando no budget normal. Validação de Packet com receipts
exige repository definitions atuais; nenhuma saída ou store inteiro é enviado.
Handoffs podem citar IDs existentes do Packet; propostas e compact test results
ficam HANDOFF_ASSERTED/UNVERIFIED no merge plan. Owner review, replay protection,
correction bounded e fallback permanecem.

Meta evaluator exige receipts nos critérios, claims materiais, validações,
scope evidence de NOT_APPLICABLE e falsification executada. Unknowns não
bloqueadores tratados continuam permitidos. Fixtures de eval possuem labels
`fixture:pass:*`, materializados somente pelo adapter de testes em execuções
locais reais; o evaluator não aceita essas labels como evidência.

## Validação e escopo

`npm run quality:evidence` executa testes e 12 evals adversariais. A suíte é parte
de `quality:gate`; changed-scope do backstop reconhece producers, schema, testes
e evals. Os testes existentes de Context, Identity, Map, Packet, Handoff e Meta
continuam sendo gates separados. Testes automatizados não provam device.

Ficam fora da camada Evidence: execução automática pelo Planner, Completion Boundary/host integration, Feedback,
retries/attempt budgets, Graphify cache/rebuild, dispatch enforcement, writers
paralelos, CAS/leases, novos profiles, Brain e promoção automática para memória.

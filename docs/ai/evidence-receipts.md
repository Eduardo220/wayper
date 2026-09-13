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
| `observation` | Union fechada: FILE, EXECUTION, DERIVATION, ASSERTION, GRAPH_REFERENCE, GRAPH_QUERY_EXECUTION |
| `result` | OBSERVED, PASS, FAIL ou UNKNOWN, condicionado ao tipo de observation |
| `producedAt`, `producer` | Timestamp ISO, nome/version do produtor |
| `contentFingerprint` | SHA-256 do conteúdo canônico; keys ordenadas recursivamente, arrays preservados |
| `parentReceiptIds` | Referências à mesma execução/revisão e repo; até 64 |
| `metadata` | Somente taskId, attemptId, failureId opcionais e bounded; sem lógica de retries |

Kinds: `SOURCE`, `DOCUMENT`, `COMMAND`, `TEST`, `QUALITY_GATE`, `RUNTIME`,
`GRAPH`, `REVIEW`, `HUMAN_DECISION`.

Origins: `SOURCE_OBSERVED`, `RUNNER_OBSERVED`, `HOST_OBSERVED`,
`HANDOFF_ASSERTED`, `MODEL_ASSERTED`, `HUMAN_ASSERTED`, `IMPORTED_LEGACY`.
HOST_OBSERVED é vocabulário reservado; nenhum adapter de runtime físico é
implementado. A schema não permite usar esse origin para inventar uma execução.

- FILE identifica path, range, bytes e fingerprint. DOCUMENT usa o mesmo
  observer e preserva provenance sem carregar documento para o Map/Packet.
- EXECUTION registra UUID por execução, cwd, comando sanitizado, fingerprint
  do comando completo, início/fim, exit code/signal, hashes e contadores de bytes
  stdout/stderr, fingerprints antes/depois e contagens TAP quando disponíveis.
- DERIVATION referencia o COMMAND observado. Kind, target, executionId, repo,
  estado, resultado e counts precisam corresponder ao pai. Não existe API pública
  para criar TEST apenas fornecendo `result: PASS`.
- RUNTIME, REVIEW e HUMAN_DECISION são assertions nesta fase. Ambiente manual,
  browser, emulador ou Android físico permanece UNVERIFIED. HUMAN_DECISION
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

```sh
npm run evidence:observe -- test --thread-id <threadId> \
  --goal-run-id <goalRunId> --revision <N> --target unit \
  -- node --test scripts/quality/check-evidence-receipts.test.mjs

npm run context:prove -- --thread-id <threadId> --goal-run-id <goalRunId> \
  --revision <N> --requirement TEST:unit --evidence ER-<sha256>

node scripts/wayper-context.mjs record --thread-id <threadId> \
  --goal-run-id <goalRunId> --revision <N> --kind receipt \
  --data '{"receiptId":"ER-<sha256>"}'
```

Modes do observer CLI: source, document, command, test, gate. Os helpers também
aceitam `{ root, execution, repositories, repository, ... }`. Store root é o
owner do Working Context; roots operacionais não são expostos no receipt.
No CLI, `--repository-id wayper-site` escolhe o subject repo; as definições
operacionais vêm do Working Context existente.

| API | Consumer futuro |
| --- | --- |
| `observeFile`, `runObservedCommand`, `runObservedTest`, `runObservedQualityGate` | Execução explícita pelo owner; executor futuro |
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

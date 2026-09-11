# Validation Planner V1 — Harness V2 Fase 3

> **Status:** vigente<br>
> **Owner:** [Harness](harness-v1.md)<br>
> **Policy executável:** [validation-registry.json](validation-registry.json)<br>
> **Dependências:** [Working Context](working-context.md), [Evidence Receipts](evidence-receipts.md)

## Boundary

O principal confirma fatos estruturados. O planner deriva requisitos, consulta
receipts e avalia suficiência conforme a policy versionada. Não interpreta texto
livre, escolhe agents, executa checks, abre aparelho nem chama completion.

```text
Goal Identity + baseline imutável
    -> operation / taskClass / scope / capabilities / risks / criteria
    -> Validation Plan V1
    -> requirements L0-L6 + candidate checks + reasons
    -> Evidence Receipt validation + approved command matching
    -> Validation Assessment
    -> Working Context / Map / Packet / Handoff owner review
```

```text
Validation Plan       != executed validation
Validation COMPLETE   != Goal DONE
candidate check       != Evidence Receipt
emulator              != physical device
build                 != runtime behavior
unit                  != integration
```

`STOP_WHEN_PROVEN` continua sendo fechamento da expansão de contexto. Um plano
anexado incompleto impede esse estado; plano COMPLETE sozinho não o produz.
Os demais requisitos/proofs do Working Context continuam necessários. Não há
Completion Boundary nem conexão nova ao Goal host.

## Inputs explícitos

`buildValidationPlan({ root, execution, repositories, inputs, registry? })`
recebe execution e repository definitions da infraestrutura da Fase 1.

`inputs` é fechado:

- `operation`: DOC_ONLY, TRIVIAL, CONFIG, TEST_ONLY, BUG_FIX, FEATURE, REFACTOR,
  ARCHITECTURAL ou CRITICAL_RUNTIME;
- `taskClass`: classe atual do Harness;
- `repositories`: fatos separados por repository, com `platforms`, `changedPaths`,
  `capabilities`, `risks` e `testTargets: { L1: [], L2: [] }`;
- `criteria`: `{ id, repository, platform, claim, required, blocking }`.

Claims classificadas: RUNTIME, RENDERING, ASSISTIVE, PROCESS_DEATH,
REMOTE_SERVICE, PHYSICAL_DEVICE, REAL_SCENARIO e WEBGL. São fatos fornecidos pelo
owner; não são novos risk flags nem capabilities inferidas de palavras.

Plataformas: shared, android, ios, web. Site não aceita plataforma nativa móvel.
Paths são relativos ao repo. DOC_ONLY rejeita caminhos não documentais. Mudança
sob `android/` exige Android no escopo. Arrays ausentes, IDs desconhecidos,
critérios contraditórios ou capabilities ausentes em operação material produzem
erro com `code: PLAN_INPUT_INCOMPLETE`.

O principal continua responsável por completar o changed scope, classificar
risco/claim e confirmar relação dos testes com os owners. O planner não é um
segundo router nem um test-impact engine. `testTargets` associa testes já
selecionados a L1/L2; o mesmo target não pode ocupar ambos. L2 aceita somente
paths aprovados no catálogo de integração do registry, evitando promoção por
mera classificação do input. A existência do teste
não prova sua suficiência semântica. Sem target aprovado, o requisito não some:
fica UNAVAILABLE com `APPROVED_CHECK_UNAVAILABLE`.

## Profundidade proporcional

| Nível | Significado | Não comprova sozinho |
| --- | --- | --- |
| L0 STATIC | Diff, lint, schema, checks determinísticos do Harness | Runtime |
| L1 UNIT | Testes isolados selecionados | Integração, SO ou aparelho |
| L2 INTEGRATION | Vários owners/componentes em ambiente de teste | Storage físico ou serviço remoto quando há mocks |
| L3 RUNTIME | Sistema/browser executado ou cenário observado | Plataforma/aparelho não observado |
| L4 PLATFORM | Build/native boundary específico da plataforma | Comportamento de background/recovery |
| L5 PHYSICAL_DEVICE | Execução com identidade física verificada | Cenário real completo |
| L6 REAL_SCENARIO | Cenário real compatível com o critério | Outros cenários não observados |

O registry é a única fonte executável de depth/check mapping. Referencia os IDs
do capability registry V2 e o vocabulário existente de riscos. Não acrescenta
profiles, capabilities nem seleção de specialist. Rules combinam seletores
estruturados; cada dimensão deve casar, valores dentro da dimensão são OR.
Requisitos equivalentes acumulam reasons, sem duplicar a obrigação.

Exemplos da policy atual:

- DOC_ONLY/TRIVIAL: diff L0; nenhuma escada física automática.
- TEST_ONLY mantém contratos locais; runtime de produto exige claim explícita
  ou mudança nativa material. TRIVIAL com risco material contraditório é rejeitado.
- Lógica material: static L0 e unit L1. Arquitetura/critical e riscos de
  durabilidade, concorrência, segurança/migração acrescentam L2.
- Persistence/run/geo/auth possuem piso de integração. O teste local-first
  existente é candidato específico de durabilidade/recovery, limitado a L2.
- Lifecycle e permissions/notifications acrescentam runtime; recovery eleva
  quando o risco/critério envolve SO. Native
  Android por capability, risco ou Kotlin/Gradle/manifest material exige L4.
- PHYSICAL_DEVICE exige L5; REAL_SCENARIO exige L5/L6; PROCESS_DEATH exige
  runtime e físico. Risco de background sem claim real não adiciona L6 por reflexo.
- Remote service exige integração e observação remota: mocks não fecham L3.
- WEBGL do site aponta aos testes unitários e Playwright existentes, incluindo
  fallback/context loss; não acrescenta Android. Compatibilidade/GPU física
  exige critério físico separado.
- Rendering/assistive explícitos acrescentam runtime, sem aparelho por padrão.

Esses exemplos explicam o registry; alterações de policy são feitas nele e
testadas mecanicamente, nunca copiadas como lógica em skills ou no router.

## Plan contract, identidade e lifecycle

Plan V1 contém `schemaVersion`, `planId`, `fingerprint`, `goalReference`,
`baselineReference`, snapshots atuais de `repositories`, `operation`,
`taskClass`, `inputs`, `registryFingerprint`, `requirements` e `status: PLANNED`.

Cada requirement contém ID estável, level/kind, scope, repo/platform, criterionId,
reasons com ruleId/facts, required/blocking, applicability estruturada,
evidencePolicy, candidateChecks e dependencies. Dependências L0 explicam a
ordem de validação; não executam ou agendam trabalho.

`VP-<sha256>` deriva do conteúdo canônico completo, sem timestamp. `VR-<hash>`
identifica check/nível/repo/plataforma/critério/scope. Inputs são normalizados e
ordenados; mesma execution, estado observado, inputs e registry geram o mesmo
plano. O hash prova integridade, não autenticidade contra writer hostil.

Plans ficam em:

```text
.wayper-context/validation/<goalRunId>/r<revision>/VP-<sha256>.json
```

Persistência individual, temporário + fsync + publicação atômica sem overwrite.
Não há database, watcher, lease ou migração de históricos. Nova observação do
scope gera outro plano; uma avaliação não altera o arquivo histórico.

Mudanças de Goal/revision/baseline, inputs, registry ou snapshot Git exigem
REPLAN_REQUIRED. Staging e commit também alteram o snapshot da Fase 1. Receipts
continuam sujeitos às próprias regras de freshness da Fase 2. A validação
reconstrói o plano esperado: recalcular o hash de um requirement rebaixado não
o torna válido.

## Evidence e assessment

`evaluateValidationPlan(plan, context)` primeiro valida o plano atual, depois
consulta o receipt store. Reutiliza `evaluateEvidenceRequirement`, que já aplica
`validateReceipt`; não duplica identity/baseline/hash/parent validation.

Policies exigem kind, resultado, repo e target específico. Checks executáveis
também exigem o fingerprint do argv aprovado e cwd correspondente, através do
COMMAND pai quando o receipt é TEST/QUALITY_GATE. Renomear um comando trivial
como Android build ou teste de integração não concede prova. O argv deve usar
o comando canônico indicado no candidate check; equivalência de shells/aliases
não é inferida.

Receipts anteriores ao plano podem usar outro label de target. O reúso desse
label só é permitido quando argv/cwd correspondem exatamente ao check aprovado;
kind, resultado, Goal/revision/baseline e repo continuam validados pela Fase 2.

L3 browser pode usar TEST/QUALITY_GATE da execução Playwright aprovada. Nos
cenários que pedem RUNTIME, a Fase 2 ainda não possui observer verificado de
runtime físico/remoto. Eles ficam UNAVAILABLE sem adapter, ou UNVERIFIED quando
só existem assertions. Nenhuma mudança no schema/trust dos receipts foi feita
para fabricar um PASS físico nesta fase.

| Requirement status | Semântica |
| --- | --- |
| SATISFIED | Receipt atual e compatível aceito |
| MISSING | Check aprovado sem evidence suficiente |
| STALE | Receipt relacionado perdeu validade |
| UNVERIFIED | Assertion/referência sem prova material |
| UNAVAILABLE | Observer/check/recurso necessário indisponível |
| NOT_APPLICABLE | Condição de plataforma explicitamente fora de escopo |
| BLOCKED | Execução aprovada observada falhou |

Cada linha retorna acceptedReceiptIds, rejectedReceiptIds, reasons e flags.
`availability` aceita somente indisponibilidade com reason code fechado, como
NO_DEVICE ou NO_CREDENTIALS; nunca aceita um booleano N/A ou override PASS.
N/A deriva da policy e plataformas declaradas, com `PLATFORM_OUT_OF_SCOPE`.

No agregado: COMPLETE se todos os required estão SATISFIED/N/A; INCOMPLETE
quando falta prova; BLOCKED para falha/indisponibilidade bloqueante;
REPLAN_REQUIRED se o plano perdeu validade. Required não é dispensado só porque
blocking=false. Optional (`required=false`, `blocking=false`) indisponível pode
coexistir com COMPLETE. A aceitação final de unknowns de Goal pertence à Fase 4.

## Integrações e consumo futuro

O writer existente pode criar/indexar o plano:

```sh
node scripts/wayper-context.mjs record --thread-id <threadId> \
  --goal-run-id <goalRunId> --revision <N> --kind validation-plan \
  --data '<JSON com inputs e availability opcional>'
```

Map armazena referência, assessment e requirements resumidos; não inclui argv,
outputs ou o plano inteiro. Refresh reavalia sob chamada e detecta alteração do
contexto do owner. Anexar plano não pode omitir capabilities obrigatórias nem
riscos já registrados no Map. `workingValidationStatus()` expõe esse estado; ausência de
plano é LEGACY_UNPLANNED, nunca COMPLETE implícito.

Packet leva apenas requirements relacionados ao repo/paths selecionados, até
24, e accepted receipt IDs dentro do budget existente. O validator rejeita
omissão, downgrade ou cross-repo leakage. Scope amplo demais deve ser reduzido;
não se descartam requirements silenciosamente.

Handoff pode propor `validationFindings` com requirementId, summary,
candidateChecks e existingEvidenceReceiptIds. O merge os classifica
HANDOFF_ASSERTED/UNVERIFIED com PLANNER_REASSESSMENT_REQUIRED. Não altera policy,
required, blocking ou N/A. Owner review e fallback continuam existentes.

| API | Uso pela Fase 4 ou consumer explícito |
| --- | --- |
| `buildValidationPlan(options)` | Derivar critérios e validações obrigatórias |
| `validateValidationPlan(plan, options)` | Detectar plano inválido/stale |
| `evaluateValidationPlan(plan, options)` | Status, provas, stale, unavailable e blockers |
| `readValidationPlan`, `listValidationPlans` | Consultar planos históricos da execução/revisão |
| `persistValidationPlan` | Publicar plano atual imutável |
| `workingValidationStatus` | Consultar assessment ligado ao Working Context |

Contagens de requisitos/níveis, receipts reused, missing, stale, unavailable e
N/A ficam no assessment. Não são métricas de tokens nem billing. IDs e receipts
rejeitados estão disponíveis ao Feedback futuro; não existem attempts/retries.

`quality:validation` cobre VP1-VP20, schema/registry, integração e evals
adversariais. Integra `quality:gate` e changed-scope do backstop. O gate testa a
infraestrutura; não executa os planos de produto.

Fora desta fase: Completion Boundary, completeGoal/Stop V2, Feedback, retries,
automatic execution/spawn, dispatch enforcement, CAS/leases, Graphify rebuild
ou cache, Brain, memory promotion, novos profiles e known-good scoring.

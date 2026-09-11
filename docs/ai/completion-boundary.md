# Connected Completion Boundary V1

> **Status:** implementado na Fase 4 do Harness V2<br>
> **Owner:** `scripts/wayper-completion-boundary.mjs`<br>
> **Escopo:** admissibilidade do projeto; transição terminal pertence ao host

## Fronteiras e diagnóstico

```text
ANTES
Meta: ledgers fornecidos -> evaluator de evals -> eligibility
Working Context -> STOP_WHEN_PROVEN (expansão de contexto)
Validation Planner -> COMPLETE (validação)
Stop -> changed files -> FAST / SKIP quando clean
Host/principal -> update_goal (sem interceptação universal)

DEPOIS
Goal -> Identity/revision/baseline -> Working Context persistido
                                      -> Context Map
                                         -> Evidence Receipts atuais
                                         -> Validation Planner
                                         -> findings/gaps/ambiguidades
                                      -> assessGoalCompletion
                                         -> ADMISSIBLE ou blockers
                                            -> principal / Stop vinculado
                                               -> host decide transição
```

`CURRENT_COMPLETION_FLOW`: o evaluator anterior tinha ledgers próprios, já
usava receipts da Fase 2, mas não lia os owners conectados. O budget evaluator
aceitava `completionEligible=true`. O backstop clean retornava `SKIP` mesmo
com requisitos faltantes; CB18 reproduziu esse comportamento antes da edição.

`CURRENT_HOST_BOUNDARY`: a tool nativa `update_goal` continua fora da API do
projeto. Não há interceptação suportada universal dessa tool nesta superfície.
O Stop recebe `session_id`, `turn_id` e `stop_hook_active`; não recebe identidade
de execução de Goal. Contrato consultado em 2026-09-11: [Codex Hooks](https://learn.chatgpt.com/docs/hooks).
CLI instalado nesta fase: `0.154.0`, feature hooks ativa. Isso não repete o smoke
end-to-end histórico de `0.147.0` documentado em [hooks-and-gates.md](hooks-and-gates.md).

`CURRENT_STOP_BEHAVIOR`: o mesmo hook versionado consulta a API quando existe
vínculo explícito válido, inclusive sem diff. Depois mantém os gates técnicos.
Reentrância não avalia, executa checks ou bloqueia novamente.

`CURRENT_BYPASSES`: host direto; hook desabilitado, sem trust ou que falha no
runtime; reentrância; sessão sem vínculo; propostas não incorporadas pelo owner;
classificação semântica incompleta. Hash não autentica contra writer hostil.

`CURRENT_EVIDENCE_INPUTS`: requirements do Working Context, checks declarados,
receipts do plano e provas de resolução. A Fase 2 revalida identidade, baseline,
repo, conteúdo, proveniência e parents. O Planner mantém L0–L6 e argv aprovado.

`CURRENT_FINDING_STATE`: Handoff possui findings, gaps e propostas; o owner
registra findings no mesmo Context Map, sem issue tracker paralelo.

`TARGET_COMPLETION_CONTRACT`:

```text
STOP_WHEN_PROVEN != VALIDATION COMPLETE
VALIDATION COMPLETE != COMPLETION ADMISSIBLE != HOST DONE
```

## API canônica

```js
assessGoalCompletion({ root, identity })
assertGoalCompletionAdmissible({ root, identity })
validateCompletionAssessment(assessment, { root, identity })
```

`identity` é o objeto fechado da Fase 1: `schemaVersion`, `threadId`,
`goalRunId`, `revision`. A API lê o Markdown canônico; não aceita substituição
por `state`, `plan`, `receipts`, `handoff` ou booleano de completion do chamador.
Avalia os snapshots atuais antes/depois e detecta mudança durante a avaliação.
Não executa testes, edits, diagnósticos, retry, dispatch ou host completion.

`workingCompletionStatus()` expõe decisão atual, blockers, assessment e stale
status do assessment registrado. `evaluateCompletion()` de Meta delega quando
há contexto conectado; os ledgers históricos continuam como diagnóstico
`LEGACY_UNVERIFIED`, nunca concedem eligibility. O budget evaluator também
consulta a API antes de aceitar uma solicitação de completion; continua
preservando os limites de budget. `COMPLETION_ADMISSIBLE` não é host DONE.

## Assessment fechado e determinístico

`schemaVersion: 1`, `assessmentId: CA-<sha256>`, `fingerprint`, `goalReference`,
`baselineReference`, `inputFingerprint`, `goalState`, `requirementState`,
`validationState`, `evidenceState`, `findingState`, `proofGapState`,
`amendmentState`, `blockers`, `warnings`, `acceptedUnknowns`, `decision`, `reasons`.

Não contém timestamp nem `goalDone`. O fingerprint cobre os inputs conectados e
resultados; snapshots incluem arquivos untracked não ignorados. Baseline
histórica continua imutável. Um assessment antigo nunca ganha autoridade só
porque seu hash está íntegro: a validação o compara com nova avaliação do owner.
Amendment, receipts/planos de outra execução, mudança de source ou owner exigem
novo assessment. Staging/commit alteram snapshots da Fase 1 e exigem nova prova.

| Decisão | Motivo |
| --- | --- |
| ADMISSIBLE | Nenhum impedimento material estruturado |
| NOT_ADMISSIBLE | Critério, validação blocking, finding, gap ou ambiguidade sem prova |
| REPLAN_REQUIRED | Plano não corresponde a Goal/revisão/baseline/inputs/estado atuais |
| REVALIDATION_REQUIRED | Prova material relacionada está stale |
| BLOCKED_EXTERNAL | Validação blocking UNAVAILABLE, inclusive observer indisponível |
| INVALID_STATE | Identidade, owner, contrato ou captura inválida/inconsistente |

Precedência nessa ordem: INVALID_STATE, REPLAN_REQUIRED,
REVALIDATION_REQUIRED, BLOCKED_EXTERNAL, NOT_ADMISSIBLE, ADMISSIBLE. Todos os
blockers permanecem disponíveis, mesmo quando outra decisão tem precedência.
Não é necessário persistir ASSESSING: UNASSESSED -> avaliação -> decisão.

## Requirements e materialidade

Os requirements existentes continuam canônicos. Cada resultado distingue
SATISFIED, UNSATISFIED, UNVERIFIED, STALE, BLOCKED e NOT_APPLICABLE. O estado
SATISFIED exige receipt compatível atual, não só o campo textual de status.
Novos Goals/amendments selam `definitionFingerprint`; apagar/rebaixar critério
sem amendment invalida o estado. Contextos anteriores continuam legíveis.

`amend.changes.requirements.add` também aceita definições estruturadas:
`{kind, id, blocking?, receiptRequirement?}`. Policy usa o schema de evidence
existente; não existe `completionEvidence`. `blocking=false` precisa pertencer
à definição, não a uma declaração na solicitação de completion. Disposição
NOT_APPLICABLE de critério exige razão e HUMAN_DECISION para `<kind>:<id>:scope`.
N/A de validação permanece derivado exclusivamente pelo Planner.

O plano precisa estar válido; a API consome `workingValidationStatus()` e seu
refresh, que chama `evaluateValidationPlan()`/`validateValidationPlan()`.
INCOMPLETE com obrigação blocking rejeita completion. Se só restam itens
explicitamente não blocking, podem ficar em acceptedUnknowns. COMPLETE nunca
dispensa os critérios globais, findings e gaps.

Sem Graphify utilizado/requerido, aparelho requerido, commit requerido ou
review adicional declarado, essas condições não criam blockers. Dirty/clean
são snapshots técnicos. Critérios de entrega determinam se commit é necessário.
Assurances explícitas (`validations`, `risk:*`, `invariant:*`) precisam de prova;
warnings/checks legados sem relação não se tornam novos requisitos.

## Findings, proof gaps e ambiguidades

O ledger opcional `contextMap.findings[]` contém `id`, `repository`, `paths`,
`severity`, `materiality`, `status`, `claim`, `scenario`, `relatedRequirementIds`,
`receiptIds`, `resolution`. Ausência não materializa coleção vazia nos legados.

Estados: OPEN, RESOLVED, ACCEPTED_RISK, NOT_APPLICABLE, INVALIDATED.
Materialidade: BLOCKING, NON_BLOCKING, INFORMATIONAL. CRITICAL/HIGH têm piso
blocking; INFORMATIONAL aberto vira warning. Recommendations não são findings.

Para fechar, `resolution` precisa de reviewer OWNER, razão, identidade/baseline
atuais, flag `humanDecisionRequired` e receipt compatível com target
`finding:<id>:<status>`. Sem isso a avaliação mantém o finding efetivamente OPEN.
O owner não reescreve silenciosamente a identidade/severidade/materialidade
do finding pelo comando record. Resolução com prova stale reabre o impedimento.
ACCEPTED_RISK CRITICAL sempre exige HUMAN_DECISION; outros casos também exigem
quando a própria resolução declara autoridade humana necessária.

A Fase 2 ainda não tem observer verificável de HUMAN_DECISION nem de runtime
físico/remoto. Esses itens permanecem sem prova; MODEL_ASSERTED, HUMAN_ASSERTED
e HANDOFF_ASSERTED não fabricam autorização humana. Não houve mudança no trust
model para contornar essa limitação.

Proof gaps usam a representação existente, com `repository`, `materiality` e
`relatedRequirementIds`. Um gap ligado a VR required/blocking aplicável bloqueia
mesmo se rotulado nonblocking; resolução exige receiptRequirement/receiptIds
compatíveis. Gap legado sem classificação gera warning de classificação; texto
livre sobre aparelho não inventa obrigação L5.

Ambiguidades de produto possuem `code`, `repository`, `materiality` MATERIAL ou
NON_MATERIAL, `status` OPEN/RESOLVED, `reason`, `relatedRequirementIds`,
`receiptIds`. MATERIAL aberto bloqueia. Resolução exige HUMAN_DECISION com
target `ambiguity:<code>`. Ambiguidades legadas do router continuam discovery.

## Blockers para a Fase 5

```text
blockerId: CB-<hash de kind/sourceId/reasonCode/repository>
kind: STATE | REQUIREMENT | VALIDATION | EVIDENCE | FINDING | PROOF_GAP | AMBIGUITY
sourceId
reasonCode
repository: wayper | wayper-site | null
blocking
relatedRequirementIds[]
relatedReceiptIds[]
relatedFindingIds[]
```

IDs não dependem da descrição humana nem de timestamp. Goal/revision/baseline
vêm do assessment pai. A Fase 5 pode consumir decision + blockers, formar sua
failure identity, diagnosticar, agir, obter novos receipts e chamar novamente
`assessGoalCompletion`. Nenhuma dessas ações posteriores foi automatizada aqui.

## Persistência e observabilidade

```text
.wayper-context/completion/<goalRunId>/r<revision>/CA-<hash>.json
.wayper-context/completion/<goalRunId>/r<revision>/attempts/<eventId>.json
.wayper-context/completion/stop/<hash-thread>.json
```

Assessments históricos são imutáveis: temporário + fsync + hardlink atômico,
sem overwrite. Paths/IDs/tamanhos e symlinks são validados. O diretório já é
ignorado pelo Git. Eventos observados registram attempts, decisão, blockerKinds,
stale assessment e acceptedUnknowns; timestamps existem só nesses eventos.
`completionTelemetry(events)` agrega admissible/rejected, revalidation/replan,
external blocks, accepted unknowns e tipos de blocker. Não há dashboard.

O Context Map guarda somente assessmentId, decision, fingerprints, stale,
até 24 blockers e 12 warnings, com contagem de omitidos. Esse índice nunca
autoriza completion; a API sempre reavalia. Packet inclui IDs/razões relevantes,
findings abertos, gaps e validation requirements, isolados por repositório.
Excesso de findings requer estreitar Packet. Handoff DONE não altera Goal;
`planContextMapMerge()` retorna propostas OPEN e `completionAuthority: NONE`,
sempre com `CONTEXT_MAP_OWNER_REVIEW_REQUIRED`. O owner incorpora cada finding
com o writer `record --kind finding`. Propostas sem repo inequívoco precisam de
classificação do owner antes de incorporação; não há discovery cross-repo nova.

## CLI e Stop suportado

```sh
node scripts/wayper-context.mjs completion --thread-id <thread> \
  --goal-run-id <run> --revision <N>
node scripts/wayper-context.mjs completion-request --thread-id <thread> \
  --goal-run-id <run> --revision <N> --turn-id <turn>
```

Ambos publicam assessment/evento e atualizam o índice pelo writer existente;
retornam zero apenas para ADMISSIBLE. completion-request também registra vínculo
explícito do Stop. `--turn-id` é preferível quando o host o expõe ao principal;
sem ele, o vínculo cobre a sessão e exige novo request explícito quando Goal ou
revision mudar. Nunca há seleção por similaridade ou descoberta por thread.
Vínculo stale/corrompido bloqueia como TOOLING_ERROR. Sessão/turn sem vínculo
mantém só o backstop técnico: não é prova de admissibilidade.

O handler preserva `stop_hook_active=true` antes de ler vínculo ou rodar checks.
Um block pede uma continuação, não impõe um lock; falha do runtime e retorno
reentrante continuam fora do enforcement. Nenhuma chamada a `update_goal` foi
adicionada ao projeto. O principal chama assertGoalCompletionAdmissible antes
da transição suportada; o projeto não prova que todo host respeita essa policy.

## Validação, migração e rollback

`npm run quality:completion`: CB1–CB24, sete adversarial evals e integrações reais
em fixtures temporárias Git/Context/Plan/Evidence, incluindo processo do hook.
`quality:gate` executa essa suíte; mudanças nos owners de completion e seus
consumidores selecionam os testes relevantes no backstop. O gate valida a API,
não implementa regras paralelas de conclusão.

Sem bulk migration. Contextos sem assessment ficam LEGACY_UNASSESSED até uma
avaliação explícita. Assessments/evidence históricos continuam preservados.
Rollback: reverter o commit da Fase 4 e manter os arquivos locais históricos;
não apagar `.wayper-context/`. Consumers antigos podem rejeitar campos novos,
por isso não reutilizar proof/index da Fase 4 como se fosse estado da Fase 3.

Sem Feedback Loop, diagnosis/retry, attempt budgets, agentes novos, dispatch
enforcement amplo, writer CAS/leases, Graphify rebuild, known-good scoring,
memória automática, aparelho físico ou source funcional do produto.

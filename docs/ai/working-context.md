# Working Context — Wayper AI Harness

> **Status:** vigente<br>
> **Escopo:** contexto operacional persistente por Codex Goal<br>
> **Owner:** [`harness-v1.md`](harness-v1.md)<br>
> **Skill:** [`wayper-context-efficiency`](../../.agents/skills/wayper-context-efficiency/SKILL.md)<br>
> **Helper:** [`scripts/wayper-context.mjs`](../../scripts/wayper-context.mjs)

## Responsabilidade

Working Context conserva apenas o estado necessário para continuar um Goal sem
reler ou redescobrir contexto já provado. Cada Goal usa um Markdown local em
`.wayper-context/<goalRunId>.md`; o diretório é ignorado pelo Git, persiste entre
turns/compaction e não é memória técnica compartilhada.

O `CONTEXT_MAP` schema v2 vive no mesmo bloco JSON. Ele é o índice compacto das
references, evidências e dependências da Goal; não possui arquivo, lifecycle ou
writer separado. Context Packets são views reconstruíveis desse índice e não
entram no Markdown como outra autoridade.

```text
NATIVE GOAL
  -> MASTER classifica e seleciona o working set
     -> helper calcula fingerprints e delta
        -> Markdown persiste Working Context + CONTEXT_MAP
           -> MASTER lê/prova/decide/valida
```

O agente principal permanece o único orquestrador e writer da síntese. O helper
não classifica linguagem, não escolhe domínio/skill/agent, não executa Graphify,
não julga semântica, não executa teste e não marca Goal completo. Ele só confere
metadata e refs de um cache Graphify já selecionado. Por isso não existe
`wayper_context_manager`.

## Fonte de verdade

O bloco JSON dentro do Markdown é a source of truth do estado operacional do
Goal: fingerprints, requirements, `CONTEXT_MAP`, budget, invalidação e Learning
Delta. Ele não substitui as fontes do produto:

1. source/testes/config atuais para estado implementado;
2. documentação/ADRs aprovados para direção;
3. Working Context apenas para registrar o que foi inspecionado/provado e se
   essa prova continua válida.

Obsidian pode abrir ou indexar `.wayper-context/` como Markdown. Nenhum comando,
plugin, vault ou metadata do Obsidian é necessário ao Harness.

## Identidade, baseline e lifecycle

`AGENTS.md` seleciona `wayper-context-efficiency` em todo Goal nativo.
A criação é explícita; `threadId` sozinho nunca seleciona uma missão persistida.

| Campo | Significado | Quando muda |
| --- | --- | --- |
| `execution.identity.threadId` | conversa do host; pode conter vários Goals | outra conversa |
| `execution.identity.goalRunId` | UUID project-owned de uma execução lógica | cada `start`, inclusive após completion ou com objetivo textual idêntico |
| `execution.identity.revision` | versão positiva e monotônica da definição | `amend` material; começa em 1 |
| `execution.baseline` | referência imutável de Git/conteúdo no início da revisão | nova revisão recebe outra captura; anterior permanece histórica |
| `goalId` | referência opaca `<goalRunId>.r<revision>` para contratos existentes | nova execução ou revisão |

Thread, objetivo lógico, execução, revisão e eventual execution attempt são
conceitos distintos. `refresh`, resume, continuação e reconstrução de contexto
preservam `goalRunId`, `revision` e baseline. Não há comparação por similaridade
textual. A superfície integrada observada nesta implementação não forneceu uma
identidade nativa de execução apropriada; o host fornece a thread, e o projeto
cria o UUID. Uma futura vinculação a ID nativo deve preservar este contrato.
`attemptId` e comportamento de retry não são implementados.

`execution` tem schema fechado: `identity` (schema 1) e `baseline` (schema 1).
A baseline contém `repositories[]`, ordenados por `repositoryId`, e fingerprint
SHA-256 do conjunto. Cada repository registra `repositoryId`,
`checkoutFingerprint` (hash do root real, sem URL/credencial), `branch` (null em
HEAD detached), `head`, `dirty` e `contentFingerprint`. O fingerprint inclui
HEAD, status, index, diff binário contra HEAD e hashes dos arquivos untracked não
ignorados. Symlinks untracked são identificados pelo link, sem ler seu alvo.
Arquivos ignorados, incluindo caches e Working Context, não entram nessa captura;
artifacts explicitamente rastreados continuam sujeitos ao próprio hash/range.
Roots devem ser repositórios Git com HEAD existente. Falha de captura não gera
baseline fictícia. Roots/branches/HEADs de `wayper` e `wayper-site` permanecem
separados; mover o checkout é incompatibilidade conservadora.

`currentRepositories` e `contextMap.repositoryState` representam o estado atual.
Eles podem mudar durante o trabalho sem reescrever a baseline.
`revisionHistory` conserva as identidades/baselines das revisões anteriores no
mesmo Markdown. Não é um event log nem snapshot completo de cada definição.
A validação confere a sequência e os fingerprints; o writer rejeita reescrita
histórica e transição de revisão inválida.

Comandos canônicos:

```sh
node scripts/wayper-context.mjs start --thread-id <threadId> \
  --objective '<objetivo lógico>' --class <TASK_CLASS> \
  --track <path[#Lx-Ly]> --risk <FLAG> --invariant <ID> \
  --validation <CHECK> --requirement <KIND:ID>
# Guardar GOAL_RUN_ID e REVISION retornados; não inferir pela thread.
npm run context:refresh -- --thread-id <threadId> \
  --goal-run-id <goalRunId> --revision <N>
npm run context:prove -- --thread-id <threadId> \
  --goal-run-id <goalRunId> --revision <N> \
  --artifact <path[#Lx-Ly]> --evidence ER-<sha256>
# Ou --requirement <KIND:ID>, em vez de --artifact.
node scripts/wayper-context.mjs record --thread-id <threadId> \
  --goal-run-id <goalRunId> --revision <N> \
  --kind <receipt|evidence|dependency|known-good|proof-gap|graphify|validation> \
  --data '<JSON compacto>'
node scripts/wayper-context.mjs router --thread-id <threadId> \
  --goal-run-id <goalRunId> --revision <N> \
  --data '<task fingerprint schema v1; goalId = referência retornada>'
node scripts/wayper-context.mjs inspect|stats|evidence|gaps|validate \
  --thread-id <threadId> --goal-run-id <goalRunId> --revision <N>
```

Packet e Handoff CLI usam o mesmo seletor triplo. Revisão ausente, diferente ou
thread divergente falha antes de reutilizar/escrever estado. `start` nunca abre
arquivo por thread; `refresh` não cria missão. O path é canônico, `--state` é
rejeitado e cada write usa temporary file + rename atômico no mesmo diretório.
Não há ponteiro de “Goal atual da thread”, lease, CAS ou merge entre waves.

### Amendment e invalidação

`amend` exige `--changes` e `--reason`. `changes.requirements` aceita patch
`{add:[], remove:[]}`; `objective`, `riskFlags`, `invariants` e `validations` são
substituições explícitas. Acrescentar critérios/constraints pelo refresh falha e
exige amendment. Descoberta de novos artifacts continua usando `--track`.

```sh
node scripts/wayper-context.mjs amend --thread-id <threadId> \
  --goal-run-id <goalRunId> --revision <N> \
  --changes '{"requirements":{"remove":["SUCCESS:old"],"add":["SUCCESS:new"]}}' \
  --reason 'Critério material substituído'
```

Sem `--invalidate`, toda prova da revisão anterior requer revalidação.
Para amendment parcial, o owner pode fornecer um objeto fechado contendo todas
as listas `artifacts`, `requirements`, `evidence`, `validations`, `capabilities`
e `graphify`. Elas nomeiam apenas IDs/specs afetados já existentes; `graphify`
usa repository IDs. O motivo deve explicar o limite semântico da alteração,
confirmado em source/callers/dependencies. O helper valida IDs e fingerprints,
mas não infere independência semântica. Se essa independência não está provada,
use a invalidação padrão. No-op é `NO_MATERIAL_AMENDMENT`; copy/metadata sem
mudança semântica não deve ser enviado como amendment.

- Slices explicitamente não afetados preservam discovery com hash atual.
  Receipts de outra revision exigem nova observação material, mesmo nesses slices.
- Artifact afetado vira `DIFF_BEFORE_FILE`, conservando `invalidatedEvidence`;
  requisito afetado volta a `PENDING`, requisito novo nasce sem evidence.
- Evidence afetada vira `STALE`; checks afetados voltam a `NOT_RUN`. Proof refs
  inválidas removem edges derivados, tornam known-good stale e reabrem gaps.
  Checks retirados da declaração permanecem inspecionáveis; seu descarte de
  escopo exige registro explícito de `NOT_APPLICABLE` pelo owner antes de stop.
- Referências Graphify afetadas ficam stale; não há rebuild automático.
- Router receipt é descartado na nova revisão. Capabilities/risks/invariants e
  os demais índices continuam no Map; o algoritmo SELECTIVE não muda.
- Mudança de branch/HEAD/checkout invalida artifacts e evidence daquele repo,
  mesmo com bytes iguais. Mudança local preserva ranges inalterados, revalida os
  artifacts rastreados e invalida checks/critérios textuais sem escopo suficiente.
  Evidence de comando/teste/observação no repo alterado requer revalidação.
- Membership de repos não muda por refresh/amend nesta fase; uma execução
  cross-repo declara ambos no start. Ownership/migração operacional ficam futuros.

Completion continua no host e no backstop existente. Depois de completion,
o owner conserva o arquivo como histórico; outro Goal exige `start`. Esta fase
não adiciona terminal state, reopen, attempt budget ou Completion Boundary.

### Compatibilidade legada

Working Context schema 1 continua legível, sem modificar seus bytes. Somente
`inspect --goal-id <id-antigo>` e `validate --goal-id <id-antigo>` aceitam o seletor
legado; retornam `LEGACY_UNVERIFIED` / `REVALIDATION_REQUIRED` (validate falha).
`contextDecision` nunca retorna `STOP_WHEN_PROVEN` para estado legado.
Refresh/prove/record/router e Packet/Handoff não promovem esse estado. Uma nova
execução começa vazia, sem importar criteria/proofs/Map. Não existe bulk migration.
Working Context e Map subiram para schema 2 porque aceitar campos de identidade
ausentes como opcionais reabriria a herança silenciosa. Packet e Handoff seguem
schema 1: `goalId` + fingerprint do Map vinculam identidade, revisão e baseline.

Rollback de código é revert do commit; arquivos schema 1 continuam preservados.
Readers antigos rejeitam schema 2 em vez de interpretá-lo como estado da thread.

Artifact mobile usa `path[#range]`. Artifact do site usa
`wayper-site:path[#range]` e requer a definição
`--repository wayper=. --repository wayper-site=../wayper-site`; fingerprint,
path persistido e known-good são calculados no root correspondente.

## Fingerprints e reuse

Fingerprint é SHA-256 do UTF-8 do arquivo ou range `#Lx-Ly`. O helper compara
artifacts solicitados quando o estado do repo permanece igual; quando Git/conteúdo
muda, revalida todos os artifacts já rastreados antes de permitir reuse.

| Status | Semântica | Próxima ação |
| --- | --- | --- |
| `READ_REQUIRED` | artifact ainda não conhecido | localizar e ler o menor range suficiente |
| `REUSE_BEFORE_READ` | fingerprint igual, sem proof material reutilizável | usar em discovery; provar antes de claim |
| `PROVEN` | evidence atual registrada | pode sustentar o slice atual |
| `KNOWN_GOOD_UNCHANGED` | fingerprint igual ao proof anterior | reutilizar sem reread |
| `DIFF_BEFORE_FILE` | fingerprint mudou | abrir diff e apenas o fluxo afetado; proof antigo fica invalidado |

`KNOWN_GOOD_UNCHANGED` é permitido somente com fingerprint idêntico e evidence
anterior. Uma mudança fora de um range não invalida o range; mudança dentro dele
invalida somente essa entrada. Se um range deixou de representar o símbolo/
failure path inteiro, o MASTER amplia o artifact em vez de confiar no hash.

Arquivo removido, path inválido, parse inválido ou escape por symlink falha como
`TOOLING_ERROR`; nunca reaproveita proof silenciosamente.

## Conteúdo persistido

Schema atual:

```text
schemaVersion | goalId | execution | objective | revisionHistory | currentRepositories
taskClass | budget
riskFlags | invariants | validations | requirements
artifacts | contextMap | learningDelta | contextDecision
```

Não persistir prompt/transcript, chain of thought, source copiado, log bruto,
secret, token, credencial, PII ou diagnóstico sensível. Evidence é uma referência
curta para path/range, comando, teste, validator ou comportamento observado.
Learning Delta retém somente `NEW_FACTS`, `NEW_PITFALLS`, `NEW_DEPENDENCIES`,
`REJECTED_ASSUMPTIONS` e `NEW_DECISIONS` relevantes ao Goal.

Working Context é temporário mesmo quando dura vários turns. Lição técnica
compartilhável continua passando por [`memory-policy.md`](memory-policy.md);
estado de Goal nunca vira repo memory automaticamente.

## CONTEXT_MAP schema v2

`contextMap` usa `REFERENCE_BEFORE_CONTENT` e contém somente:

```text
schemaVersion | goalId | execution | taskClass | repositories
taskFingerprint | routerFingerprint | registryFingerprint | repositoryState
capabilities | router | risks | invariants | evidence | dependencies
knownGood | graphify | validation | learningDelta
ambiguities | proofGaps | metrics
```

`registryFingerprint` vincula o mapa ao Registry V2 corrente; mudança invalida
router/capabilities anteriores antes de novo packet. `invariants` permanece no
mapa para que nenhuma view derivada economize contexto descartando uma restrição declarada. Evidence, proof gaps e queries
Graphify podem carregar `capabilityRefs` validadas contra o Registry V2; entradas
legadas sem essas refs continuam válidas, mas não são atribuídas a uma
capability por heurística textual.

- `repositoryState` mantém, por `wayper` ou `wayper-site`, root lógico, branch,
  HEAD, refs relevantes, dirty fingerprint e relevant-diff fingerprint. Diff e
  arquivos não são copiados; estados cross-repo permanecem independentes.
- `evidence` usa ID Goal-local determinístico, repository/path, symbol/range
  opcional, source hash, claim curto, provenance e status. Dedupe usa repository
  + locator + source hash + category + claim normalizada, não só texto idêntico.
  Conclusão da análise anterior usa
  `reviewDisposition=PRIOR_ANALYSIS_CONCLUSION`; o mesmo marcador estruturado vale para proof gaps
  e validations. Review independente não infere esse boundary por palavras.
- `evidenceReceipts` indexa receipts V1 do mesmo lifecycle, com kind, subject,
  provenance, baseline relation, verification/reasons e summary bounded.
  [Evidence Receipts](evidence-receipts.md) define observers, store e aceitação.
  Evidence refs legadas continuam úteis para discovery; texto não satisfaz prova.
- Evidence source-backed cujo hash diverge vira `STALE` no refresh. O validator
  rejeita `PROVEN` silenciosamente stale. Range além do EOF falha. `context:prove`
  exige receipt observado compatível; regex de range ou token PASS/FAIL em texto
  não constitui prova.
  Se um range antes válido desaparecer porque o arquivo encolheu, refresh o marca
  `RANGE_INVALIDATED` em vez de abortar e deixar proof antiga ativa.
- `dependencies` registra endpoints repo-scoped, relação e provenance
  `SOURCE|GRAPHIFY|CONFIG|TEST|DOC`; exige evidence `PROVEN|HIGH_CONFIDENCE`.
  Ambos os paths precisam existir e a proof deve corresponder a ao menos um
  endpoint. Evidence stale remove o edge derivado e reabre proof gap resolvido.
- `graphify` guarda decisão e fingerprints/version/query purpose/node/edge refs
  por repository. Metadata, hash do `graph.json` e IDs consultados são conferidos
  no cache repo-scoped; queries são ordenadas por fingerprint e troca de graph
  invalida queries anteriores. Mudança posterior no estado do repository marca
  refs `STALE`; `NOT_NEEDED` com query e ref de outro repository falham.
- `knownGood` exige fingerprint + proof refs. Source alterado vira `STALE`; uma
  Goal que questiona o comportamento marca `QUESTIONED` persistentemente e não
  reutiliza a prova. Artifact do site permanece no estado do site; arquivo
  removido vira `SOURCE_MISSING`. Capability known-good usa fingerprint da entrada
  correspondente no Registry V2; ID ausente ou fingerprint divergente falha.
  Uma proof fresca do artifact substitui a entrada stale/questioned; ela só volta
  a `KNOWN_GOOD_UNCHANGED` no próximo refresh sem mudança.
  Sem receipt suficiente, `verification` é `KNOWN_GOOD_UNVERIFIED`; esse estado
  não permite completion. O scoring do router não foi alterado nesta fase.
- `proofGaps` separa claims abertas do que já foi provado. `learningDelta`
  acrescenta somente IDs adicionados, atualizados ou invalidados.
- `metrics` mede bytes do JSON canônico, `ceil(bytes/4)`, counts e bytes de
  source referenciados. `OVER_BUDGET` nunca trunca e exige motivo explícito.

O validator também rejeita campos fora do schema fechado, excesso estrutural,
schema/IDs/refs/status inválidos, duplicate evidence, repository state stale,
source blobs, transcript, chain-of-thought, tool diary, raw diff/Graphify, agent
summary e valores gigantes. Motivo de `OVER_BUDGET` não autoriza campos extras.
Todas as coleções compactas possuem caps estruturais e o mapa tem limite absoluto
de 1 MB, mesmo quando há motivo legítimo para exceder o ceiling da task.
Um mapa não cruza execuções/revisões:
`goalId`, `execution.identity` ou baseline divergente e schema incompatível falham; após completion ele pode ser
consultado, mas reuse em outra Goal exige nova criação e novas provas.

## Context Packets derivados

[`scripts/wayper-context-packet.mjs`](../../scripts/wayper-context-packet.mjs)
constrói e valida schema v1 fechado para target `agentProfile`, `nativeRole`,
`capabilitySet` ou `validationRole`. O fluxo é somente:

```text
CONTEXT_MAP validado + Registry V2 + router receipt + target
  -> capability/repository filtering
  -> dependency closure comprovada
  -> refs + budget + metrics
  -> Context Packet derivado
```

Packets guardam IDs e locators, não source blobs. Paths precisam já existir como
refs de evidence/dependency/repository state no mapa e coleções têm limites.
Evidence fora do path primário
só entra por capability/ref explícita ou `DEPENDENCY_CLOSURE`; Graphify entra
somente por query `CURRENT` já validada no mapa. Fingerprint divergente produz
`PACKET_STALE`; Registry fingerprint divergente também falha e exige refresh.
`INDEPENDENT_REVIEW_PACKET` remove known-good e somente evidence/proof gaps/
validations marcados como conclusões anteriores; falhas objetivas não marcadas
continuam visíveis. `FOLLOWUP_REVIEW_PACKET` pode referenciá-los.
Nenhum comando envia packet a agent, chama Graphify ou autoriza spawn. Somente
receipt `ROUTER_SELECTED` validado pode autorizar o target specialist; fallback
continua no gate comportamental.

## Structured Handoff v1 e ativação controlada

[`scripts/wayper-structured-handoff.mjs`](../../scripts/wayper-structured-handoff.mjs)
fecha o output especializado complementar ao packet. O schema contém somente
identidade Goal/task/agent/packet, status, confidence, coverage, findings,
evidence refs, evidence proposta, risks/recommendations, reads/writes, testes,
proof gaps, ambiguities, blockers e métricas derivadas. Transcript, source blob,
raw Graphify/diff, tool diary, stdout/stderr e chain-of-thought são inválidos.

O validator reconfirma o Context Packet, Goal, Registry/profile, refs, status de
evidence, capabilities, repositories, paths/ranges/hashes, classificação de
source expansion, read-only, grounding de findings, caps e budget. Evidence nova
usa ID local `NE-*` e não possui status; o merge plan a mantém `UNVALIDATED`.
Somente o owner atual pode chamar o writer canônico do `CONTEXT_MAP`.
`INDEPENDENT_REVIEW_PACKET` e `FOLLOWUP_REVIEW_PACKET` preservam a política do
input porque o handoff só pode usar refs presentes no packet validado.

O adapter preserva o canary e acrescenta `PACKETIZED_DEFAULT` depois de uma
seleção comportamental ou de receipt `ROUTER_SELECTED`. A preparação valida Context Map,
Registry/profile read-only e packet; em sucesso exige `forkTurns=none`,
`readOnly=true` e zero descendants. O resultado final entregue pelo runtime
admite no máximo uma correção bounded. Packet/handoff inválido ou indisponível
retorna `LEGACY_BOUNDED_BRIEF` para o mesmo specialist; ausência de seleção não
executa nada. Não há daemon, polling, retry loop, spawn pelo router ou writer
packetized. Goals sem `S1/S2` specialist preservam o fluxo anterior e não recebem
packet. `npm run quality:handoffs` cobre o validator,
activation/fallback e os 20 cenários de
[`structured-handoff-evals.json`](structured-handoff-evals.json).

`HARNESS_SPECIALIST_DISPATCH_V1` também exige model/reasoning explícito por
dispatch, derivado deterministicamente de task class, riscos e capabilities do
packet. O gate estático rejeita dispatch direto em source/config e o consumer
rejeita receipt divergente. A ausência de interceptação suportada mantém somente
invocações manuais externas como `OUT_OF_BAND_UNENFORCEABLE`.

## Budgets e stop

Os ceilings por classe vivem na skill e no helper. São proxy inicial de contexto
(`ceil(UTF-8 bytes / 4)`), não receipt, quota nem hard cap nativo. Contexto
obrigatório pode exceder o ceiling somente com
`BUDGET_ESCALATION_REASON`; contexto opcional é cortado primeiro.

`STOP_WHEN_PROVEN` exige ao menos um artifact e um requirement, todos com
receipts verificados e compatíveis, revalidados no consumo;
um check evidenciado `risk:<FLAG>` para cada risco e `invariant:<ID>` para cada
invariante; demais checks PASS com receipt compatível; nenhum proof gap aberto ou
resolvido apenas por texto/refs legadas, nenhum
known-good stale/questionado e nenhuma staleness sem prova atual. Se Graphify for
`REQUIRED_BY_STRUCTURAL_UNCERTAINTY`, o estado do repository precisa ser `CURRENT`.
Ele encerra somente expansão de contexto/Graphify/spawn. Conclusão do Goal ainda
segue Completion Eligibility e Final Falsification; prova de contexto não prova
que implementação e entrega terminaram.

## Graphify e subagents

Graphify é cache gerado separado. Fingerprints do source selecionam:

- relevant repository scope unchanged: reuse do graph existente;
- relevant scope changed: `npm run graphify:update -- mobile|site`;
- structural uncertainty ausente: Graphify não roda.

Mobile e site nunca compartilham dependency graph. Goal cross-repo consulta os
dois caches repo-scoped e combina evidence depois, sem merge. Metadata gerada
registra root/repository, branch/HEAD, fingerprint, versão, timestamp, scope e
ignores; `npm run quality:graph-scopes` valida integridade e contaminação.
Queries usam budget e símbolo/path alvo. Resultado material volta ao source.
Subagent, quando já autorizado pelo gate, recebe apenas outcome, scope,
symbols/files, constraints, risk, evidence, validation e Learning Delta. Ele não
recebe Working Context completo nem cria descendants; `max_depth=1` permanece.

## Gate e benchmark

`npm run quality:context` executa regressões de identidade, baseline, amendment,
legado e CLI, além de round-trip, invalidação localizada,
range unchanged, stop-when-proven, path safety, schema/map validation,
staleness, deduplicação, Graphify repo-scoped e compactness, além dos benchmarks em
[`context-efficiency-evals.json`](context-efficiency-evals.json).

Cada benchmark declara BEFORE/AFTER e os conjuntos de risk flags, invariants,
validations e tests. O gate só passa se AFTER reduzir o token proxy, ficar no
ceiling (ou declarar escalada) e preservar/superpor todos esses conjuntos.
Semantic review e execução real dos testes continuam obrigatórias.

O mesmo gate chama `quality:packets`: schema/determinism/staleness, refs inválidas,
repository leakage, review independence, budgets, materialização zero e 20
cenários SHADOW. O benchmark compara broad materialization com packet bytes e
exige 100% de coverage de evidence/capability/proof gaps antes da redução.

O corpus do `CONTEXT_MAP` executa 15 cenários em repositories Git temporários e
independentes (inclusive source real do `wayper-site`) usando as funções reais de
refresh/record/router/validator. Ele cobre bounded, bug multi-file,
lifecycle, persistence, territory, cross-domain, site, cross-repo, staleness,
Graphify, dedupe, proof gap e known-good. Compara bytes materializados sem mapa
com o JSON realmente serializado; não mede nem estima billing de provider.

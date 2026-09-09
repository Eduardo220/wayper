# Working Context — Wayper AI Harness

> **Status:** vigente<br>
> **Escopo:** contexto operacional persistente por Codex Goal<br>
> **Owner:** [`harness-v1.md`](harness-v1.md)<br>
> **Skill:** [`wayper-context-efficiency`](../../.agents/skills/wayper-context-efficiency/SKILL.md)<br>
> **Helper:** [`scripts/wayper-context.mjs`](../../scripts/wayper-context.mjs)

## Responsabilidade

Working Context conserva apenas o estado necessário para continuar um Goal sem
reler ou redescobrir contexto já provado. Cada Goal usa um Markdown local em
`.wayper-context/<threadId>.md`; o diretório é ignorado pelo Git, persiste entre
turns/compaction e não é memória técnica compartilhada.

O `CONTEXT_MAP` schema v1 vive no mesmo bloco JSON. Ele é o índice compacto das
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

## Lifecycle automático no Goal

`AGENTS.md` seleciona `wayper-context-efficiency` em todo Goal nativo. A skill:

1. obtém `threadId` e classifica o trabalho;
2. inicializa/atualiza o arquivo com `context:refresh`;
3. consulta status antes de qualquer releitura;
4. acrescenta artifacts/dependencies somente após evidence;
5. registra proof com `context:prove`;
6. registra somente novas evidências/dependências/gaps no mapa;
7. para expansão quando `contextDecision=STOP_WHEN_PROVEN`.

Comandos canônicos:

```sh
npm run context:refresh -- --goal-id <threadId> --class <TASK_CLASS> \
  --track <path[#Lx-Ly]> --risk <FLAG> --invariant <ID> \
  --validation <CHECK> --requirement <KIND:ID>
npm run context:prove -- --goal-id <threadId> \
  --artifact <path[#Lx-Ly]> --evidence <source|test|command>
npm run context:prove -- --goal-id <threadId> \
  --requirement <KIND:ID> --evidence <source|test|command>
node scripts/wayper-context.mjs record --goal-id <threadId> \
  --kind <evidence|dependency|known-good|proof-gap|graphify|validation> \
  --data '<JSON compacto>'
node scripts/wayper-context.mjs router --goal-id <threadId> \
  --data '<task fingerprint schema v1>'
node scripts/wayper-context.mjs inspect|stats|evidence|gaps|validate \
  --goal-id <threadId>
```

`refresh`, `prove`, `record` e `router` são os únicos writes; os cinco últimos
comandos são read-only. `router` persiste hashes/refs e um receipt
`ROUTER_SELECTED` ou `BEHAVIORAL_FALLBACK`; nunca executa spawn.
O output normal é delta-only. O estado completo permanece no Markdown. O path é
sempre `.wayper-context/<goalId>.md`: `--state` é rejeitado e todo write usa
temporary file + rename atômico no mesmo diretório.

Lifecycle não duplica o estado do Goal nativo. Criação ocorre no primeiro
`refresh`; resume/refresh conserva somente proof com fingerprint atual;
`prove` e `record` fazem append/update determinístico; source/proof alterado
invalida os derivados. Completion continua pertencendo ao Goal nativo e ao seu
backstop, não a um bit gravado pelo mapa. Depois da completion o Markdown é
arquivo read-only daquela Goal. Outra Goal recebe outro `goalId` e outro arquivo;
mapa antigo pode ser consultado, mas nunca importado ou promovido automaticamente.

Artifact mobile usa `path[#range]`. Artifact do site usa
`wayper-site:path[#range]` e requer a definição
`--repository wayper=. --repository wayper-site=../wayper-site`; fingerprint,
path persistido e known-good são calculados no root correspondente.

## Fingerprints e reuse

Fingerprint é SHA-256 do UTF-8 do arquivo ou range `#Lx-Ly`. O helper compara
somente artifacts solicitados; entradas não tocadas permanecem intactas.

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
schemaVersion | goalId | taskClass | budget
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

## CONTEXT_MAP schema v1

`contextMap` usa `REFERENCE_BEFORE_CONTENT` e contém somente:

```text
schemaVersion | goalId | taskClass | repositories
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
- Evidence source-backed cujo hash diverge vira `STALE` no refresh. O validator
  rejeita `PROVEN` silenciosamente stale. Range além do EOF falha; evidence sem
  source range ou resultado observado (`PASS|FAIL|BLOCKED|NOT_APPLICABLE`) também.
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
Um mapa não cruza Goals:
`goalId` divergente ou schema incompatível falha; após completion ele pode ser
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

`STOP_WHEN_PROVEN` exige ao menos um artifact e um requirement, todos com proof;
um check evidenciado `risk:<FLAG>` para cada risco e `invariant:<ID>` para cada
invariante; demais checks `PASS|NOT_APPLICABLE`; nenhum proof gap aberto, nenhum
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

`npm run quality:context` executa testes de round-trip, invalidação localizada,
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

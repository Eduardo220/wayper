# Capability Architecture + Context Closure — Wayper AI Harness

> **Status:** vigente<br>
> **Escopo:** descoberta e composição on-demand de conhecimento do Wayper<br>
> **Owner:** [`harness-v1.md`](harness-v1.md)<br>
> **Registry:** [`capability-registry.json`](capability-registry.json)<br>
> **Router:** [`context-routing.md`](context-routing.md)<br>
> **Evals:** [`capability-routing-evals.json`](capability-routing-evals.json) e
> [`design-routing-evals.json`](design-routing-evals.json)

## Princípio

```text
BROAD CAPABILITY LIBRARY
+ SMALL CONTROL PLANE
+ PROGRESSIVE DISCLOSURE
+ MINIMUM SUFFICIENT WORKING SET
```

Quantidade total não é gate. O custo que precisa permanecer proporcional à
tarefa é o working set selecionado. O registry é catálogo on-demand, não prompt
permanente, router executável, grafo autoritativo ou autorização de produto.

## Vocabulário e ownership

| Conceito | O que é | Owner / o que não é |
| --- | --- | --- |
| `DOMAIN` | Área ampla de responsabilidade usada no primeiro roteamento, como `SOCIAL` ou `RUN_RUNTIME` | `context-routing.md`; não é unidade carregável nem causa raiz presumida |
| `CAPABILITY` | Unidade nomeada de conhecimento ou comportamento que pode ser necessária para explicar/alterar uma tarefa | registry; não implica uma skill própria |
| `SKILL` | Workflow/knowledge de domínio reutilizável, com metadata permanente pequena e corpo on-demand | `.agents/skills/`; não é processo transversal, reviewer ou source of truth |
| `REFERENCE` | Documento canônico suficiente para cobrir capability que não merece skill | docs/ADR owner; não repete workflow genérico |
| `CAPABILITY_ONLY` | Decisão de não criar skill/reference quando source/owners já bastam | resultado válido de promotion; schema v1 persiste somente capabilities asset-backed |
| `SPECIALIST` | Reviewer read-only independente selecionado por risco concreto | `.codex/agents/`; não implementa, orquestra ou aprova integração |
| `PROCESS` | Sequência transversal como bug investigation ou safe refactor | `process-workflows.md`; não recebe metadata de skill por padrão |
| `TOOL` | Mecanismo de busca, shell, gate ou apoio de discovery | runtime/global/project conforme owner; output nunca vira verdade por si só |
| `MEMORY` | Lição hard-earned auxiliar, seletiva e invalidável | `memory-policy.md`; nunca precede source, teste ou decisão canônica |

Uma capability pode ser coberta por `SKILL` ou `REFERENCE`; uma candidate também
pode terminar `CAPABILITY_ONLY` e não criar asset/entry artificial. Source e
testes continuam owners do comportamento implementado; o asset ensina como
trabalhar no domínio sem copiar a implementação para o registry.

## Registry canônico

[`capability-registry.json`](capability-registry.json) é a única lista
machine-readable de capabilities. Ele contém somente:

- domains já definidos pelo router;
- assets `SKILL` ou `REFERENCE` e paths relativos existentes;
- capability, domain primário, asset mínimo e relações `suggests` esparsas.

O registry não contém triggers completos, callers, testes, regras de quality,
processos, specialist checklists, source graph ou conteúdo dos assets. Esses
owners permanecem onde já vivem. `suggests` acelera discovery; não autoriza load.

O validator canônico é:

```sh
npm run quality:capabilities
```

Ele valida schema, IDs, domains, paths, metadata das quatro skills, referências,
relações e evals. Não classifica linguagem natural, não usa embeddings/vector DB,
não lê o grafo inteiro e não altera o Stop hook.

As capabilities de design usam `DESIGN.md` como uma reference deduplicada. O
contrato de seleção específico é validado por:

```sh
npm run quality:design
```

Nenhuma delas foi promovida a skill na baseline: não há observed reuse e a
reference já cobre o workflow sem metadata permanente.

## Política skill vs reference

Avalie depois de source/task/catalog, nunca pela ausência de um nome parecido.

### `PROMOTE_TO_SKILL`

Todos os obrigatórios:

- capability tem boundary discriminativa e negative triggers claros;
- workflow/knowledge é Wayper-specific e não apenas “investigue e teste”;
- repetição, risco ou custo de redescoberta foi observado;
- body on-demand reduz erro/contexto mais do que metadata permanente acrescenta;
- não duplica process, quality, architecture policy, source, docs ou skill ativa.

Gate de ROI explícito:

```text
OBSERVED_REUSE + FAILURE_PREVENTION + REDISCOVERY_COST
> PERMANENT_DISCOVERY_COST + MAINTENANCE + OVERLAP
```

Sem evidência dos termos à esquerda, mantenha reference. A equação é decisão
qualitativa documentada, não score inventado nem telemetria presumida.

### `KEEP_AS_REFERENCE`

Use quando contrato/documento atual basta, frequência ou risco ainda não prova
ROI, workflow é curto/derivável, ou metadata adicional custaria mais que a
redescoberta. Ranking, XP, friends e membership permanecem references nesta
baseline; criar skills para melhorar uma demonstração seria artificial.

### `MERGE`

Mescle quando duas skills compartilham owner, invariantes, triggers e validação,
ou quase sempre são carregadas juntas pelo mesmo source walk. Preserve o nome
mais claro, consolide consumers e retire metadata duplicada. Não mescle apenas
por relação semântica: ranking e friends podem variar independentemente.

### `DEPRECATE`

Deprecie quando source/owner deixou de existir, asset virou derivável/canônico
em outro lugar, triggers não discriminam, uso real é zero e o custo permanente é
material, ou uma skill sucessora cobre integralmente o contrato. Marque sucessor,
migração e rollback; não apague silenciosamente nem mantenha alias indefinido.

## Routing em duas passagens

### Pass 1 — Intent Routing

Resolver da intenção, sem presumir causa:

```text
ENTRY_DOMAIN
ENTRY_CAPABILITY
ENTRY_SKILL_OR_REFERENCE
```

O domínio nomeado pelo usuário é entrypoint. “Bug no ranking” inicia em
`SOCIAL / weekly-ranking`; não conclui que o owner da causa também é ranking.
Quando o registry não contém capability com nome idêntico, procure significado,
source e catálogo antes de declarar gap.

### Pass 2 — Dependency Expansion

Depois de abrir o consumer/owner real, acrescentar somente dependencies
confirmadas pelo source relevante. Relação `suggests`, Graphify, nome de feature,
proximidade de arquivo ou associação de produto são hipóteses de discovery.

```text
GRAPH SUGGESTS.
SOURCE CONFIRMS.
```

Não percorra transitivamente `suggests`. Cada expansão precisa de evidence e
classificação. A causa pode migrar para outro domínio, inclusive XP, sync,
membership, persistence ou lifecycle.

## Source Dependency Walk

Para `BUG`, `INVESTIGATION` e `ARCHITECTURAL`, percorra quando aplicável:

```text
SYMPTOM
-> CONSUMER
-> OWNER
-> CONTRACT
-> DATA SOURCE
-> TRANSFORMATION
-> PERSISTENCE/SYNC
-> UPSTREAM PRODUCER
```

Não force todas as etapas. Pare quando comportamento, causa/impacto e prova
suficiente estiverem explicados. Continue somente quando contexto adicional
tiver valor esperado material, como owner incerto, failure path não coberto,
contrato persistido, producer upstream ou risco novo.

## Classificação da dependency

| Classe | Evidência | Contexto acrescentado |
| --- | --- | --- |
| `INTERFACE_ONLY` | Só shape/contrato público afeta a tarefa | contract/source range; não carregar body da skill/reference dependente |
| `BEHAVIOR_RELEVANT` | Implementação interna altera cálculo, branch, ordering ou failure path | capability + asset correspondente + source/testes causais |
| `OWNER_CRITICAL` | Mudança/causa atinge owner, invariante crítica, persistência, lifecycle, segurança ou migration | capability + asset + owner/source + testes; memory/review apenas pelos gates existentes |

Classificação não eleva automaticamente Q/R. Ela informa o router; classe,
risk flags e diff real continuam owners de quality e specialists.

## Minimum Sufficient Context Closure

Context Closure é o menor working set de capabilities, assets, source,
contracts, testes, memory e evidence suficiente para:

1. explicar o comportamento e o owner afetado;
2. alterar o owner correto sem criar caminho paralelo;
3. validar success/failure paths proporcionais ao risco;
4. identificar o que permanece fora e por quê.

```text
LOAD_MINIMUM_CONTEXT
-> ENTRY_CAPABILITY
-> SOURCE_DEPENDENCY_WALK
-> DEPENDENCY_EXPANSION
-> CONTEXT_CLOSURE
-> IMPLEMENT
```

Closure não significa ler o mínimo a qualquer custo. Significa parar quando
contexto adicional possui baixo valor esperado. Relações não confirmadas,
capabilities sem efeito causal, skills já cobertas pelo mesmo asset e domains
semanticamente próximos ficam fora.

Contratos internos úteis:

```text
ENTRY: DOMAIN | CAPABILITIES | ASSETS
EXPANSION: CAPABILITY | CLASSIFICATION | SOURCE_EVIDENCE
CLOSURE: CAPABILITIES | ASSETS | CONTRACTS | SOURCE | TESTS | MEMORY | REVIEW
EXCLUDED: CAPABILITY | REASON
GAPS: REQUIREMENT | SEARCHED_TASK_SOURCE_CATALOG
```

Rastreabilidade mínima da entrega:

```text
TASK -> DOMAIN -> CAPABILITY -> SKILL/REFERENCE
     -> SOURCE_EVIDENCE -> TEST_EVIDENCE -> DELIVERY_EVIDENCE
```

`DELIVERY_EVIDENCE` registra comando/checagem, resultado e divergência material;
não exige log bruto versionado nem repete source/teste dentro do registry.

## Reavaliação por safe slice

Em Meta longa, descarte o working set no fim de cada slice e volte ao Pass 1
para o próximo. Preserve somente Learning Delta relevante. Skill carregada em
uma wave anterior não permanece ativa por inércia; domain, evidence e risk do
novo slice precisam justificá-la novamente.

Antes de escolher o slice seguinte, registre somente mudanças reais em
`CAPABILITY_IMPACT`, `LEARNING_DELTA`, `OVERLAP` e decisão
`KEEP / PROMOTE / MERGE / DEPRECATE`. Ausência de delta encerra a reavaliação;
não cria documento, skill ou cleanup para demonstrar atividade.

## Capability Gap

`CAPABILITY_GAP` existe somente quando, após investigar a task, source atual e
registry, nenhuma capability cobre adequadamente o knowledge/workflow necessário.
Não significa “não encontrei skill com esse nome”.

Registre:

```text
REQUIREMENT | TASK_SEARCH | SOURCE_SEARCH | REGISTRY_SEARCH | WHY_UNCOVERED
```

Gap não autoriza instalar skill, adquirir capability externa ou criar plugin.
Ele vira candidate/follow-up sujeito a ROI e Human Decision Boundary. Find
Skills/external acquisition permanecem fora desta unidade.

## Custos e escala

As métricas pertencem a [`token-economy.md`](token-economy.md). O registry e os
evals são on-demand, logo não alteram o prompt permanente. O validator mede
bytes reais de registry/assets e o payload de discovery das skills do projeto;
isso não é receipt de billing nem tamanho total do prompt do runtime.

O Codex inicia com name, description e path de cada skill e carrega o body ao
selecioná-la; listas grandes podem ter descriptions reduzidas ou skills omitidas.
Por isso o registry funciona também como discovery hierárquico: o Pass 1 abre o
catálogo pequeno por domínio/capability e só então lê o path do asset escolhido.
Não existe limite artificial de skills; promoção continua baseada em ROI.

## Evals e limites

[`capability-routing-evals.json`](capability-routing-evals.json) cobre composição
positiva/negativa, dependency inesperada, relação negada, no-recursion, gap,
multi-skill e catálogo de 70 capabilities simulado em memória. Capabilities
sintéticas não são persistidas.

Precision/recall do validator mede igualdade do working set contra fixtures
declarativas, não acurácia semântica do modelo sobre linguagem natural. Source
e julgamento do agente continuam indispensáveis. O validator prova que evidence
explícita compõe somente o conjunto esperado e que relações não auto-carregam.

[`design-routing-evals.json`](design-routing-evals.json) acrescenta copy-only,
spacing, ranking, pós-corrida, mapa, accessibility, runtime bug, refactor,
celebração, settings/profile, typography e audit. Casos `NONE` precisam manter
capabilities e assets de design vazios; capabilities compartilhando o contrato
deduplicam a mesma reference e carregam zero skill bodies.

# Wayper AI Harness V1

> **Status:** vigente<br>
> **Escopo:** repositório mobile<br>
> **Versão:** Foundation + Routing + Skill Workflows + Orchestration + Static
> Analysis + Budgets + Boundaries + Adaptive Quality + Meta Goal + High-Signal
> Memory + Automated Gates + Token Economy + Capability Architecture + Design
> Intelligence + External Skill Acquisition + Evidence-Gated Completion + Goal
> Budget Control (`HARNESS`, não end-to-end) + Evidence-backed Finalization
> Reserve (`ACTIVE`) + Persistent Working Context + Context Efficiency +
> Registry Schema V2 + Repository-scoped Graphify + Goal-scoped Context Map +
> Packetized Specialist Dispatch + Structured Handoff + Selective Router +
> V2 Fases 1–3 Goal Identity/Baseline + Evidence Receipts + Validation Planner, 2026-09-10<br>
> **Decisão relacionada:** `docs/08-decisoes-tecnicas.md`<br>
> **Inventário de origem:**
> [`docs/audits/2026-08-16-ai-harness-v1-foundation.md`](../audits/2026-08-16-ai-harness-v1-foundation.md)

## Fonte de verdade

O único owner operacional do mobile é [`AGENTS.md`](../../AGENTS.md). Ele aponta
para o catálogo de fontes; não replica estratégia, workflows de domínio ou
configuração de ferramentas.

```text
AGENTS.md
  -> Goal nativo carrega wayper-context-efficiency + Working Context/CONTEXT_MAP
  -> TASK_MODE ou META_GOAL_MODE pela intenção
     -> goal contract quando a intenção for contínua
     -> task class + risk flags
        -> diff real + Q0-Q3 gate + R0-R3 review
        -> process contract quando necessário + context map mínimo
           -> Pass 1: entry domain/capability/skill-or-reference
           -> decisão S0 single ou delegação com valor comprovado
           -> docs/00-fontes-do-projeto.md + memory match/asset sob demanda
           -> source dependency walk + Pass 2 por evidence
           -> minimum sufficient context closure
              -> Context Packet derivado para target explícito
              -> waves/read-only specialists quando necessário
                 -> execution + evidence + validation pelo agente principal
                    -> completion eligibility + final falsification
                       -> Goal Execution Report
                          -> Stop backstop determinístico
```

[`docs/14-instrucoes-para-ia.md`](../14-instrucoes-para-ia.md) é o workflow
detalhado. Este arquivo possui arquitetura e ownership; auditorias são apenas
evidência datada.

A Fase 1 V2 evolui o mesmo Working Context/Map para schema 2. `threadId`
identifica conversa; `goalRunId` identifica execução; `revision` versiona a
definição; baseline conserva o estado inicial de cada revisão. O lifecycle
explícito e a leitura segura de legado pertencem a
[`working-context.md`](working-context.md). Packet/Handoff v1 transportam a
referência por `goalId` e fingerprint do Map. A Fase 2 acrescenta
[Evidence Receipts V1](evidence-receipts.md) ao mesmo lifecycle: observação
project-owned, store local imutável por execução/revisão, índice no Map e IDs
bounded no Packet/Handoff. Prova material exige receipt verificado e compatível;
texto, shell direto e assertions não substituem execução observada. A Fase 3
acrescenta [Validation Planner V1](validation-planner.md): facts estruturados
selecionam requisitos L0-L6 e receipts existentes produzem assessment. Planner
não executa checks nem conclui Goals. Fases 4+ não estão ativadas.

## Recursos project-scoped

- `scripts/wayper-validation-{policy,planner,store}.mjs`,
  `validation-registry.json` e [validation-planner.md](validation-planner.md):
  policy executável, plano imutável Goal/revision-scoped e assessment bounded;
  `quality:validation` integra o gate FAST.

- `scripts/wayper-evidence-{receipts,store,observer}.mjs` e
  [`evidence-receipts.md`](evidence-receipts.md): schema V1, observação,
  persistência Goal-scoped e aceitação determinística; `quality:evidence` integra
  o gate FAST. O hash prova integridade, não autenticidade criptográfica.

- `docs/ai/task-classification.md` e `docs/ai/context-routing.md`: decisão
  operacional declarativa sob demanda; o executável pode selecionar profile
  read-only somente com receipt seletivo fechado e fallback comportamental.
- `docs/ai/process-workflows.md`: processos transversais sob demanda e decisão
  skill-vs-native; não é skill nem novo orquestrador.
- `docs/ai/orchestration.md`: modos, decomposition, waves, synthesis e políticas
  de escrita; não é planner executável nem custom orchestrator.
- `docs/ai/static-analysis.md`: stack, severidades e baseline do comando
  canônico `npm run lint`; detalhes são carregados somente em `TEST_BUILD`.
- `docs/ai/code-budgets.md`: targets graduais, ratchet de tamanho, exceções e
  ranking estrutural; `npm run quality:size` é o gate de regressão.
- `docs/ai/architecture-boundaries.md`: owners reais, inventários e boundaries
  sob demanda; `npm run quality:architecture` impede novos consumers inválidos.
- `docs/ai/quality-gates.md`: Q0-Q3, R0-R3, delta, finding contract e síntese;
  `npm run quality:gate` agrega somente os gates FAST de repositório.
- `docs/ai/meta-goal-runtime.md`: Goal Execution Contract, budget resolution e
  checkpoints, autonomia, accounting, ledgers, completion eligibility, final
  falsification, report e stop conditions; carregado somente para intenção contínua.
- `docs/ai/meta-goal-completion-evals.json` e
  `scripts/quality/check-meta-goal-completion.mjs`: evals machine-readable e
  shadow `OLD_DECISION`/`NEW_DECISION`, incluindo budget; não são runtime de produção.
- `docs/ai/memory-policy.md` e `docs/ai/memory/index.json`: promotion de
  hard-earned learning e discovery por domínio/risco; index/topics nunca são
  contexto permanente nem source of truth.
- `docs/ai/hooks-and-gates.md`: capability audit e completion backstop
  project-scoped; automatiza somente gates determinísticos por changed-scope.
- `docs/ai/token-economy.md`: modos `COMPACT/CLEAR/EXACT`, leitura progressiva,
  briefs mínimos, compaction nativa e medição sem confundir bytes com billing.
- `docs/ai/working-context.md`, `.agents/skills/wayper-context-efficiency/`,
  `scripts/wayper-context.mjs`, suas bibliotecas `scripts/wayper-context-map.mjs` e
  `scripts/wayper-context-identity.mjs` e
  `docs/ai/context-efficiency-evals.json`: reuse/diff/fingerprint/delta e
  `CONTEXT_MAP` schema v2 por execução/revisão, budgets, validator e benchmark/gate; um único
  Markdown é o estado persistente e o helper não decide semântica.
- `docs/ai/capability-architecture.md` e
  `docs/ai/capability-registry.json`: vocabulário, policy skill-vs-reference,
  metadata canônica de capabilities/profiles, routing em duas passagens e
  Context Closure on-demand.
- `scripts/quality/check-capability-routing.mjs`: validator/evals determinísticos
  do registry; não é intent classifier, runtime ou dependency walker automático.
- `scripts/wayper-agent-router.mjs` e
  `docs/ai/agent-router-shadow-evals.json`: fingerprint, matching, set-cover,
  receipts seletivos, comparação e métricas SHADOW; não executam agent ou Graphify.
- `scripts/wayper-context-packet.mjs`, seu teste/evaluator e
  `docs/ai/context-packet-evals.json`: views fechadas, capability-scoped,
  budgets, staleness, dedupe e telemetria SHADOW; não injetam prompt nem executam
  agent.
- `scripts/wayper-structured-handoff.mjs`, seu teste/evaluator e
  `docs/ai/structured-handoff-evals.json`: output v1 fechado, validator, merge
  plan owner-only e adapter final-event. Depois de seleção comportamental ou
  receipt `ROUTER_SELECTED`,
  os profiles read-only usam packet/handoff por default com fallback
  bounded; o adapter valida, mas não decide `S0-S3` nem executa agent.
- `docs/ai/external-skill-acquisition.md`, provenance/evals relacionados e
  `scripts/quality/check-external-skill-acquisition.mjs`: gate `CAPABILITY_GAP`,
  vetting, trial, update/revocation e provenance on-demand; não instalam skills.
- `DESIGN.md`, `docs/ai/design-routing-evals.json` e
  `scripts/quality/check-design-routing.mjs`: contrato visual, Context Closure de
  design e métricas on-demand; não alteram tokens/runtime nem criam skill.
- `docs/ai/routing-evals.md`: contrato positivo e negativo sem API externa.
- `.agents/skills/`: quatro workflows de domínio do mobile e uma skill
  transversal de eficiência, automática somente em Goal nativo/context work.
  Apenas `name` e `description` entram na descoberta; o corpo é on-demand.
- `.codex/agents/`: os quatro profiles com instrução/sandbox próprios mantêm TOML
  read-only; os demais usam `nativeRole: explorer` do Registry. O adapter fixa
  model/reasoning por dispatch conforme risco/tarefa.
- Não há `.codex/config.toml` do projeto: o Harness não sobrescreve modelo,
  permissões ou concorrência do usuário. `.codex/hooks.json` possui somente o
  backstop `Stop`; ele não é approval/security boundary.

Papéis genéricos de descoberta, implementação, segurança genérica e revisão usam
capacidades nativas do Codex. TOMLs project-scoped continuam restritos a
concorrência, lifecycle mobile, persistência e geoespacial; profiles adicionais
reusam role nativa e Context Packet.
Find Skills não é project-scoped: a estratégia Wayper é `CLI_ONLY`, acionada
explicitamente somente depois de gap provado. Instalação global preexistente
continua configuração do usuário e subordinada ao Router Wayper.

## Fronteiras

| Escopo | Owner | Conteúdo permitido |
| --- | --- | --- |
| `MOBILE_PROJECT` | este repositório | regras, skills e especialistas específicos do app |
| `SHARED_WAYPER` | workspace pai | somente conhecimento realmente comum entre repositórios |
| `USER_GLOBAL` | configuração do usuário | RTK, plugins, preferências, credenciais e ferramenta Graphify genérica |
| `GENERATED_RUNTIME` | ferramenta produtora | graph, cache, maps, benchmarks, logs e hooks instalados |
| `DEPRECATED` | backup externo | Brain/router, agentes genéricos e snapshots substituídos |

Secrets, tokens, preferências de modelo e paths pessoais não são versionados.
Site skills e o revisor WebGL pertencem ao site e não ao mobile.

## Graphify, RTK, Caveman e hooks

Graphify é um índice auxiliar opcional. Quando o mapa amplo justificar o custo,
o agente seleciona um dos dois scopes code-only: `mobile` (`wayper`) ou `site`
(`wayper-site`). Cada repositório possui seu próprio `graphify-out/`, fingerprint
e metadata gerada; não existe dependency graph misto como autoridade. Uma Goal
cross-repo consulta os dois graphs separadamente e só então combina evidence.
`npm run graphify:build|graphify:update -- <scope>` mantém os caches e `npm run
quality:graph-scopes` bloqueia contaminação, paths externos e edges inválidos.
Working Context permite reuse apenas com fingerprint inalterado. Não há refresh
automático por Git, e toda pista material é confirmada diretamente no source.

RTK é ferramenta global opcional. O projeto não inclui adapter, proxy ou segundo
sistema de compressão e deve continuar operável com shell comum.

Caveman também permanece global e opcional. Compressão de model output não
altera source, evidence ou prosa persistida. Seleção segura e medições pertencem
a [`token-economy.md`](token-economy.md).

Os hooks Git `post-commit` e `post-checkout` do Graphify foram removidos após o
ROI da Unidade 17; refresh é explícito quando uma task realmente seleciona o
grafo. O hook Codex/RTK e hooks de plugins são configuração do usuário. O único
hook do projeto é o completion backstop descrito em
[`hooks-and-gates.md`](hooks-and-gates.md); nenhum hook é fonte de regras do
mobile ou substitui Q/R.

## Progressive disclosure

1. carregar `AGENTS.md` e metadata de descoberta;
2. em Goal nativo, carregar `wayper-context-efficiency`, refrescar fingerprints
   e consultar Working Context antes de reler;
3. distinguir task pontual de meta contínua; carregar Goal contract só na meta;
4. classificar tarefa/flags e selecionar gate/review pelo diff real;
5. executar Pass 1 e selecionar processo, entry domain/capability e asset mínimo;
6. consultar o memory index somente quando domínio/risco justificar e abrir no
   máximo os topics relevantes;
7. permanecer single-agent ou decompor somente por valor e independência;
8. localizar symbols/headings e preferir ranges suficientes a arquivos grandes;
9. confirmar código, callers e testes, expandir dependencies por classificação e
   fechar Context Closure; memory nunca substitui essa confirmação;
10. sintetizar e subir contexto, Graphify ou especialista só por evidência;
11. parar expansão quando requirements e artifacts estiverem provados.

Não existe ciclo `AGENTS -> docs -> skill -> AGENTS`: skills referenciam owners,
mas não redefinem política nem orquestram agents; apenas recomendam specialists
pelas flags.

## Fora da V1

Não existe wave planner executável, custom orchestrator, adjudicator, agent
genérico novo, benchmark automático de concorrência ou worktree permanente.
Knowledge graph novo, memory runtime/search engine, billing/token middleware e
framework/DSL de boundaries permanecem fora. O token proxy operacional é apenas
`ceil(bytes/4)` no benchmark. A repo memory é somente política, índice pequeno
e topics on-demand. Boundaries simples de import e o ratchet owner-specific
estão implementados sem nova dependência.
Context Efficiency acrescenta somente uma skill, Markdown por Goal e helpers
determinístico de SHA-256/benchmark. Não cria compressor, hook de compaction,
session logger, tokenizer, billing estimator, router ou manager agent.
O `CONTEXT_MAP` permanece uma seção do mesmo Markdown e o módulo importado não é
CLI concorrente. O packet builder cria somente views derivadas; não persiste
segunda verdade, produz spawn, escolhe agent, cria lease/worktree, Control Tower,
event bus ou vector DB. O efeito operacional fica restrito a selecionar profile
no caso fechado e adaptar input/output depois que o Decision Gate já autorizou
`S1/S2` read-only.
Capability Architecture também permanece declarativa: não cria embeddings,
vector DB, banco, intent classifier, full-graph loader ou segundo execution
runtime. O resolver determinístico só tem autoridade para o profile listado em
receipt `ROUTER_SELECTED`; todo residual volta ao gate comportamental e registry/
evals seguem on-demand.
External Skill Acquisition também permanece policy + ledger + evals on-demand:
não cria marketplace, package manager, scanner, hook, config, dependency ou
runtime paralelo; nenhum candidato externo foi promovido nesta baseline.
Design Intelligence também permanece declarativa: não instala Impeccable,
detector web, hook, sidecar, fonte, dependency ou runtime visual. `DESIGN.md`
possui o contrato; `WayperTheme` continua owner dos valores executáveis.
As quatro skills mobile possuem workflows de domínio; a quinta é transversal e
restrita a Goal/context efficiency. Processos genéricos permanecem nativos e
usam os contratos de
[`docs/ai/process-workflows.md`](process-workflows.md). A delegação segue
[`docs/ai/orchestration.md`](orchestration.md).
`wayper-brain` permanece somente no backup histórico, sem reativar código, agent
ou configuração. Meta Goal e seu Completion Judge são contratos declarativos em
[`meta-goal-runtime.md`](meta-goal-runtime.md), não runtime custom; o checker
associado executa somente evals. Promotion e
staleness de memória pertencem a
[`memory-policy.md`](memory-policy.md); Learning Delta pode persistir no Working
Context do Goal, mas não é promovido automaticamente a repo memory.

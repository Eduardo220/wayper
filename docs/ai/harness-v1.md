# Wayper AI Harness V1

> **Status:** vigente<br>
> **Escopo:** repositório mobile<br>
> **Versão:** Foundation + Routing + Skill Workflows + Orchestration + Static
> Analysis + Budgets + Boundaries + Adaptive Quality + Meta Goal + High-Signal
> Memory + Automated Gates + Token Economy V1,
> 2026-08-23<br>
> **Decisão relacionada:** `docs/08-decisoes-tecnicas.md`<br>
> **Inventário de origem:**
> [`docs/audits/2026-08-16-ai-harness-v1-foundation.md`](../audits/2026-08-16-ai-harness-v1-foundation.md)

## Fonte de verdade

O único owner operacional do mobile é [`AGENTS.md`](../../AGENTS.md). Ele aponta
para o catálogo de fontes; não replica estratégia, workflows de domínio ou
configuração de ferramentas.

```text
AGENTS.md
  -> TASK_MODE ou META_GOAL_MODE pela intenção
     -> goal contract quando a intenção for contínua
     -> task class + risk flags
        -> diff real + Q0-Q3 gate + R0-R3 review
        -> process contract quando necessário + context map mínimo
           -> decisão S0 single ou delegação com valor comprovado
           -> docs/00-fontes-do-projeto.md + memory match/skill sob demanda
           -> source, callers e testes atuais
              -> waves/read-only specialists quando necessário
                 -> synthesis + validation pelo agente principal
                    -> outputs generated, nunca autoridade
```

[`docs/14-instrucoes-para-ia.md`](../14-instrucoes-para-ia.md) é o workflow
detalhado. Este arquivo possui arquitetura e ownership; auditorias são apenas
evidência datada.

## Recursos project-scoped

- `docs/ai/task-classification.md` e `docs/ai/context-routing.md`: decisão
  declarativa sob demanda; não existe processo/router executável.
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
- `docs/ai/meta-goal-runtime.md`: Goal contract, autonomia, Execution Kernel,
  candidate ranking, budget, follow-ups, learning delta e stop conditions;
  carregado somente para intenção contínua.
- `docs/ai/memory-policy.md` e `docs/ai/memory/index.json`: promotion de
  hard-earned learning e discovery por domínio/risco; index/topics nunca são
  contexto permanente nem source of truth.
- `docs/ai/hooks-and-gates.md`: capability audit e completion backstop
  project-scoped; automatiza somente gates determinísticos por changed-scope.
- `docs/ai/token-economy.md`: modos `COMPACT/CLEAR/EXACT`, leitura progressiva,
  briefs mínimos, compaction nativa e medição sem confundir bytes com billing.
- `docs/ai/routing-evals.md`: contrato positivo e negativo sem API externa.
- `.agents/skills/`: quatro workflows de domínio do mobile. Apenas `name` e
  `description` entram na descoberta; o corpo é carregado quando o domínio casar.
- `.codex/agents/`: quatro revisores especializados, todos read-only e sem modelo
  fixado pelo projeto.
- Não há `.codex/config.toml` do projeto: o Harness não sobrescreve modelo,
  permissões ou concorrência do usuário. `.codex/hooks.json` possui somente o
  backstop `Stop`; ele não é approval/security boundary.

Papéis genéricos de descoberta, implementação, segurança e revisão usam
capacidades nativas do Codex. Agents project-scoped existem somente para
concorrência, lifecycle mobile, persistência e geoespacial.

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

Graphify é um índice auxiliar ativo. Sua configuração e ciclo de geração não
mudam nesta fundação; `graphify-out`, maps e caches nunca entram no contexto
permanente nem substituem source. Toda pista material é confirmada diretamente.

RTK é ferramenta global opcional. O projeto não inclui adapter, proxy ou segundo
sistema de compressão e deve continuar operável com shell comum.

Caveman também permanece global e opcional. Compressão de model output não
altera source, evidence ou prosa persistida. Seleção segura e medições pertencem
a [`token-economy.md`](token-economy.md).

Os hooks Git `post-commit` e `post-checkout` instalados pelo Graphify são runtime
local, assíncrono e fail-open. O hook Codex/RTK e hooks de plugins são configuração
do usuário. O único hook do projeto é o completion backstop descrito em
[`hooks-and-gates.md`](hooks-and-gates.md); nenhum hook é fonte de regras do
mobile ou substitui Q/R.

## Progressive disclosure

1. carregar `AGENTS.md` e metadata de descoberta;
2. distinguir task pontual de meta contínua; carregar Goal contract só na meta;
3. classificar tarefa/flags e selecionar gate/review pelo diff real;
4. selecionar processo, domínios, catálogo/docs e skills mínimas;
5. consultar o memory index somente quando domínio/risco justificar e abrir no
   máximo os topics relevantes;
6. permanecer single-agent ou decompor somente por valor e independência;
7. localizar symbols/headings e preferir ranges suficientes a arquivos grandes;
8. confirmar código, callers e testes; memory nunca substitui essa confirmação;
9. sintetizar e subir contexto, Graphify ou especialista só por evidência.

Não existe ciclo `AGENTS -> docs -> skill -> AGENTS`: skills referenciam owners,
mas não redefinem política nem orquestram agents; apenas recomendam specialists
pelas flags.

## Fora da V1

Não existe wave planner executável, custom orchestrator, adjudicator, agent
genérico novo, benchmark automático de concorrência ou worktree permanente.
Knowledge graph novo, memory runtime/search engine, token proxy e framework/DSL
de boundaries permanecem fora. A repo memory é somente política, índice pequeno
e topics on-demand. Boundaries simples de import e o ratchet owner-specific
estão implementados sem nova dependência.
Token Economy também permanece declarativa: não cria compressor, hook de
compaction, session logger, tokenizer ou billing estimator do projeto.
As quatro skills possuem workflows de domínio; processos genéricos permanecem
nativos e usam os contratos de
[`docs/ai/process-workflows.md`](process-workflows.md). A delegação segue
[`docs/ai/orchestration.md`](orchestration.md).
`wayper-brain` permanece somente no backup histórico, sem reativar código, agent
ou configuração. Meta Goal é contrato declarativo em
[`meta-goal-runtime.md`](meta-goal-runtime.md), não runtime custom. Promotion e
staleness de memória pertencem a
[`memory-policy.md`](memory-policy.md); Learning Delta não é salvo
automaticamente.

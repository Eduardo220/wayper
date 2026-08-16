# Auditoria — Wayper AI Harness V1 Foundation

> **Status:** concluída<br>
> **Data:** 2026-08-16<br>
> **Escopo:** mobile, workspace Wayper, configuração global e runtime/generated<br>
> **Owner atual:** [`docs/ai/harness-v1.md`](../ai/harness-v1.md)<br>
> **Baseline histórica:**
> [`2026-08-16-ai-harness-baseline.md`](2026-08-16-ai-harness-baseline.md)

## Git observado

- Git root: `/home/eduardo/Wayper/wayper`.
- Branch inicial: `feat/wayper-ai-harness`.
- HEAD inicial e `origin/develop`: `65a60a6d6d26b03500dc2053d4de1735ff01d791`.
- Merge-base: o mesmo commit; ahead/behind inicial: `0/0`.
- Working tree inicial: limpa.
- Workspace pai não é Git root; `wayper-site` é outro repositório e estava sujo,
  portanto não foi alterado.

Antes de desativar recursos externos, o estado completo relevante foi arquivado
em `/home/eduardo/Wayper/backups/ai-harness-v1-foundation-20260816-191434/`:
`workspace-harness.tgz` e `user-global-harness.tgz` foram lidos com `tar -tzf` e
possuem checksums SHA-256 registrados na entrega. Recursos desativados também
permanecem expandidos em `inactive-workspace/` para recuperação seletiva.

## Inventário por escopo

As colunas agrupam todos os campos pedidos: nome/path; tipo/scope; tracked/active;
owner/purpose/consumers; canonical/duplicates/dependencies; recommendation.

### Mobile repository

| Name / path | Type / scope | Tracked / active | Owner, purpose e consumers | Canonical, duplicação e dependências | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `AGENTS.md` | instrução / `MOBILE_PROJECT` | sim / sempre | owner operacional do mobile; consumido pelo Codex | canônico; detalhes saíram para docs/skills | `KEEP`, simplificado |
| `docs/00-fontes-do-projeto.md` | catálogo / `MOBILE_PROJECT` | sim / sob referência | roteia fontes por tarefa | canônico para seleção; depende das docs listadas | `REWRITE` pontual |
| `docs/14-instrucoes-para-ia.md` | workflow / `MOBILE_PROJECT` | sim / sob demanda | explica processo sem redefinir regras | canônico para workflow; duplicação removida | `REWRITE` |
| `docs/ai/harness-v1.md` | arquitetura / `MOBILE_PROJECT` | sim / sob demanda | ownership e fronteiras do Harness | canônico para a fundação | `KEEP` |
| `.agents/skills/wayper-*` | skills / `MOBILE_PROJECT` | sim / trigger | quatro rotas de domínio; consumidas por agente principal/especialistas | fontes são docs/source atuais; substituem cópias do workspace | `MOVE` + reduzir |
| `.codex/agents/wayper_*_reviewer.toml` | agents / `MOBILE_PROJECT` | sim / explícito | quatro revisores read-only | especializados; sem modelo ou router fixo | `MOVE` + reduzir |
| `.git/hooks/post-commit` | hook / `GENERATED_RUNTIME` | não / ativo | Graphify atualiza graph após commit | não canônico; depende de Graphify/Python/path local | `KEEP_RUNTIME` |
| `.git/hooks/post-checkout` | hook / `GENERATED_RUNTIME` | não / ativo | Graphify atualiza graph após checkout | não canônico; depende de Graphify/Python/path local | `KEEP_RUNTIME` |
| baseline e esta auditoria | evidência / histórico | sim / não operacional | registram snapshots datados | não normativas; apontam para owner atual | `KEEP_HISTORY` |

### Wayper workspace

| Name / path | Type / scope | Tracked / active | Owner, purpose e consumers | Canonical, duplicação e dependências | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `/home/eduardo/Wayper/AGENTS.md` | instrução / `SHARED_WAYPER` | não / só ao abrir workspace | seleciona o repositório alvo | não governa o mobile; antes repetia Brain/skills/agents | `REWRITE` mínimo |
| `.agents/skills/` | 9 skills históricas / misto | não / 2 após consolidação | antes: Graphify, Brain, mobile, site e Caveman; depois: somente site | ownership misturado foi separado | separar conforme auditoria abaixo |
| `.codex/agents/` | 15 agents históricos / misto | não / 1 após consolidação | antes: pipeline próprio; depois: compatibilidade do site | genéricos/Brain arquivados; mobile versionado | separar conforme auditoria abaixo |
| `.codex/config.toml` | config / `LOCAL_MACHINE_ONLY` | não / só workspace | preferências de subagents | desnecessário à fundação; nenhuma feature mobile depende | `REMOVE` ativo, preservar backup |
| `.graphifyignore` | config / `SHARED_WAYPER` | não / ativo | filtros do graph do workspace | fonte de configuração, não graph | `KEEP` |
| `docs/ai/*.md` | docs / histórico | não / stale | maps/status anteriores à cleanup | fatos antigos substituídos pelo Git atual | `DEPRECATE` para backup |
| `.codex/maps/` | maps / `GENERATED_RUNTIME` | não / stale | navegação histórica | output derivado, HEAD antigo | arquivar fora do runtime ativo |
| `.codex/benchmarks/` | benchmark / histórico | não / stale | comparação datada de modelos | depende de versões antigas e Brain | arquivar fora do runtime ativo |
| `graphify-out/` | graph/cache / `GENERATED_RUNTIME` | não / ativo | índice estrutural; Graphify é consumidor/produtor | ~9,3 MB, reproduzível, não autoridade | `KEEP_GENERATED` |
| `RTK.md` | instrução / `USER_GLOBAL` | não / ativo por referência antiga | resumo local do RTK | duplica `~/.codex/RTK.md` | `REMOVE` duplicate |
| `skills-lock.json` | lock / `DEPRECATED` | não / ativo antigo | fixava Caveman duplicado | perde consumidor após remoção da cópia | `REMOVE` |

### User/global Codex

| Name / path | Type / scope | Tracked / active | Owner, purpose e consumers | Canonical, duplicação e dependências | Recommendation |
| --- | --- | --- | --- | --- | --- |
| `~/.codex/AGENTS.md` + `RTK.md` | instrução / `USER_GLOBAL` | não / sempre | política pessoal de shell RTK | canônico do usuário, fora do projeto | `KEEP_GLOBAL` |
| `~/.codex/config.toml` | config / `USER_GLOBAL` | não / ativo | modelo, effort, plugins, trust e preferências | contém escolhas pessoais; não versionar | `KEEP_GLOBAL` |
| `~/.codex/hooks.json` | hook config / `USER_GLOBAL` | não / ativo | adapter RTK com guarda de workspace | unversioned, fail-open e path local | `KEEP_GLOBAL`, reavaliar com RTK oficial |
| `~/.agents/skills/` | 8 antes / 9 depois | não / discovery | Cavecrew, Caveman, Graphify e utilitários genéricos | fora do ownership Wayper; Graphify movido do workspace | `KEEP_GLOBAL` |
| `~/.codex/skills/.system/` | 6 skills do Codex | runtime / discovery | recursos oficiais instalados | gerenciado pelo Codex | `KEEP_SYSTEM` |
| plugin skills/hooks/cache | plugin / `USER_GLOBAL` + runtime | não / ativo quando plugin | Ponytail e demais plugins | provider é owner; cache é derivado | `KEEP_PLUGIN`, não copiar |
| MCP | config / `USER_GLOBAL` | n/a / ausente | nenhum servidor configurado | confirmado por `codex doctor` | nenhuma ação |

## AGENTS.md: bloco por bloco

| Bloco anterior | Decisão | Destino |
| --- | --- | --- |
| identidade/prioridade do projeto | `KEEP_ALWAYS_LOADED` | resumo em `AGENTS.md` |
| quatro leituras obrigatórias em toda tarefa | `STALE` | duas entradas permanentes; matriz decide o restante |
| estado versus direção | `KEEP_ALWAYS_LOADED` | forma compacta em `AGENTS.md`; detalhe no catálogo |
| checklist longo | `MOVE_TO_DOC` | Context Gate em `docs/14` |
| invariantes da corrida | `KEEP_ALWAYS_LOADED` | preservados no `AGENTS.md` |
| protocolo de divergência | `MOVE_TO_DOC` | `docs/14`, com resumo permanente |
| limite de escopo | `DUPLICATE` | incorporado ao bloco de implementação |
| entrega detalhada | `MOVE_TO_DOC` | owner em `docs/14`; resumo em `AGENTS.md` |

## Skills históricas

O total inicial Wayper-owned é 9. Skills globais, system e de plugins foram
inventariadas acima, mas não contam como recursos do projeto.

| Name / path | Description e trigger | Do not trigger | Scope / references | Overlap e valor atual | Cost | Decision |
| --- | --- | --- | --- | --- | --- | --- |
| `caveman` / workspace | compressão genérica, por pedido explícito | conteúdo crítico sem compressão | `USER_GLOBAL`; própria documentação | cópia byte-identical da global | 87 linhas / 6.216 B | `REMOVE` workspace |
| `graphify` / workspace | workflow genérico da CLI, quando navegação estrutural ajuda | tarefa conhecida ou evidência final | `USER_GLOBAL`; manual próprio | útil, mas 41 KB e não Wayper-specific | 710 / 41.000 B | `MOVE` global |
| `wayper-active-run` | lifecycle de corrida ativa | derivados/território isolado | `MOBILE_PROJECT`; docs/source/testes atuais | real especialização; fatos/referências antigas corrigidos | 23 / 1.293 B antes | `MOVE` + reduzir |
| `wayper-brain` | classificar/rotear tarefa e compute | tarefa trivial ou Unit 2 | `DEPRECATED`; nove referências próprias | sobrepõe AGENTS, docs e Unit 3 | 36 / 2.185 B + 27 KB refs | `DEPRECATE` |
| `wayper-mobile-shell` | entry/auth/navigation/permissões | runtime interno/fila | `MOBILE_PROJECT`; owners atuais | domínio distinto; paths normalizados | 21 / 1.109 B | `MOVE` + reduzir |
| `wayper-persistence-sync` | save/finalização/fila/sync | GPS/território isolado | `MOBILE_PROJECT`; owners atuais | protege ordering local-first | 23 / 1.329 B | `MOVE` + reduzir |
| `wayper-site-design-content` | conteúdo/SEO/tokens do site | mobile ou WebGL | site; refs próprias | valor real, repo errado para esta branch | 19 / 1.096 B | `MOVE` ao site, pendente |
| `wayper-site-motion-webgl` | motion/Canvas/WebGL do site | mobile/SEO | site; refs próprias | valor real, repo errado para esta branch | 20 / 1.078 B | `MOVE` ao site, pendente |
| `wayper-territory-map` | geometria/captura/mapa | lifecycle/fila isolados | `MOBILE_PROJECT`; docs/source/testes atuais | domínio distinto | 21 / 1.190 B | `MOVE` + reduzir |

Contagem: `KEEP 0`, `MERGE 0`, `REWRITE 0`, `MOVE 7`, `DEPRECATE 1`,
`REMOVE 1`, `UNKNOWN 0`. Os quatro moves mobile foram reescritos no destino;
os dois moves do site não alteram o repositório sujo nesta unidade.

## Custom agents históricos

| Name | Role/scope/mode | Read/write | Trigger e especialização | Overlap/model config | Valor e decisão |
| --- | --- | --- | --- | --- | --- |
| `wayper_mapper` | discovery genérico | read-only | localizar caminhos | duplica explorer; Luna low fixo | `REMOVE` |
| `wayper_researcher` | pesquisa externa | read-only | API/standard externo | duplica agente principal; Luna low | `REMOVE` |
| `wayper_tester` | runner genérico | writable temporário | validação pós-change | duplica worker; Luna low | `REMOVE` |
| `wayper_debugger` | diagnóstico genérico | read-only | falha reproduzível | duplica default/explorer | `REMOVE` |
| `wayper_architect` | arquitetura genérica | read-only | decisão consequencial | duplica default | `REMOVE` |
| `wayper_implementer` | writer genérico | writable | uma mudança bounded | duplica worker | `REMOVE` |
| `wayper_reviewer` | review geral | read-only | diff bounded | duplica review nativo | `REMOVE` |
| `wayper_final_reviewer` | integração multi-review | read-only | T2/T3 pós-fixes | depende de Brain/tiers | `DEPRECATE` até unidade posterior |
| `wayper_adjudicator` | conflito premium | read-only | disputa T3 | Sol high fixo; depende de Brain | `DEPRECATE` |
| `wayper_concurrency_reviewer` | race/ordering mobile | read-only | async compartilhado concreto | especialização real; modelo fixo removido | `MOVE` + reduzir |
| `wayper_mobile_lifecycle_reviewer` | lifecycle/native mobile | read-only | background/recovery/permissão | especialização real | `MOVE` + reduzir |
| `wayper_persistence_reviewer` | persistência/fila | read-only | risco de perda/replay | especialização real | `MOVE` + reduzir |
| `wayper_geospatial_reviewer` | território/geometria | read-only | mudança geoespacial | especialização real | `MOVE` + reduzir |
| `wayper_security_reviewer` | trust boundary genérica | read-only | risco de segurança concreto | duplica review nativo; Terra high fixo | `REMOVE` |
| `wayper_web_performance_reviewer` | WebGL/performance site | read-only | risco web concreto | especialização real, scope site | `MOVE` ao site, pendente |

Contagem: `KEEP 0`, `MERGE 0`, `REWRITE 0`, `MOVE 5`, `DEPRECATE 2`,
`REMOVE 8`. Os quatro moves mobile usam configuração nativa project-scoped,
read-only, sem roteador, modelo ou compute tier fixado.

## Hooks

| Event | Path/scope | Purpose | Blocking/failure/output | Dependencies/versioned | Recommendation |
| --- | --- | --- | --- | --- | --- |
| Git `post-commit` | mobile `.git/hooks` / runtime | refresh Graphify | async, fail-open; log em cache | Python, Graphify, path local; não | manter runtime |
| Git `post-checkout` | mobile `.git/hooks` / runtime | refresh Graphify | async, fail-open; log em cache | Python, Graphify, path local; não | manter runtime |
| Codex `PreToolUse` | `~/.codex/hooks.json` / global | adapter RTK restrito ao workspace | 5 s, fail-open, saída pequena | Node + RTK + path local; não | manter global; não copiar |
| plugin `SessionStart` | Ponytail cache / global | ativa modo | 5 s; plugin controla falha/output | Node/plugin; não | plugin-owned |
| plugin `UserPromptSubmit` | Ponytail cache / global | rastreia modo | 5 s | Node/plugin; não | plugin-owned |
| plugin `SubagentStart` | Ponytail cache / global | propaga modo | 5 s | Node/plugin; não | plugin-owned |

Nenhum hook complexo foi migrado: o mecanismo atual funciona, não é requisito do
mobile e sua fonte versionável ainda depende de uma decisão de workspace/global.

## Graphify

- Versão/binário: `0.9.38`, `~/.local/bin/graphify`.
- Status: `ACTIVE_AND_USEFUL`; query ampla localizou runtime e a confirmação foi
  feita no source.
- Config: `.graphifyignore` no workspace; graph global vazio.
- Output: `graphify-out/graph.json` (~9,3 MB), manifest/report/cache e maps são
  `GENERATED_RUNTIME`.
- Consumers: consultas manuais e hooks Git mobile; o site não possuía os hooks
  alegados por docs antigas.
- Política: não reinstalar, não carregar output por padrão, nunca usar graph como
  prova final.

## RTK

- Versão/binário: `0.45.0`, `~/.local/bin/rtk`.
- Benefício medido: 2.833 comandos; 24,3 M tokens de input, 4,4 M de output e
  19,9 M economizados (81,9%) no histórico local.
- Owner: `USER_GLOBAL`; política em `~/.codex/RTK.md`.
- O resumo `Wayper/RTK.md` era duplicado. Nenhum adapter, compressor ou regra RTK
  foi adicionado ao repositório.
- Classificação: `KEEP_GLOBAL`; adapter existente permanece runtime global e não
  é requisito do Harness mobile.

## Configuração e dependency map

- Codex `0.147.0` aceita a configuração global e a antiga configuração do
  workspace em modo `--strict-config`; nenhum MCP está configurado.
- O mobile não precisa de `.codex/config.toml`. Modelos, effort, plugin enablement,
  trust e credenciais permanecem globais.
- O ciclo antigo `workspace AGENTS -> wayper-brain -> agents -> skills -> AGENTS`
  foi retirado do mobile ativo.
- O fluxo atual é acíclico: instrução -> catálogo -> contexto selecionado ->
  source/teste -> revisão especializada opcional -> output descartável.

## Contexto permanente

Métricas após a consolidação:

| Camada mobile | Antes | Depois |
| --- | ---: | ---: |
| `AGENTS.md` | 111 linhas / 5.027 B | 56 linhas / 2.772 B |
| project config | 0 | 0 |
| skill metadata | 0 skills | 4 skills / 720 B |
| agent metadata | 0 agents | 4 agents / 642 B |
| total project metadata aproximado | 5.027 B | 4.134 B |

Corpos de skills e instruções de agents são on-demand. Docs, graph, maps,
benchmarks e baseline não entram no contexto permanente. A redução conservadora,
contando toda metadata descoberta, é 893 B (17,8%).

## O que não foi implementado

Task Classifier, Context Router, novo Graph, memory system, token compression,
review multi-agent completo, ESLint e limite de 350 linhas permanecem fora desta
unidade. O material antigo do Brain/tiers foi preservado no backup externo, não
reativado no mobile.

## Validação

- `git diff --check`: passou.
- manifests: 4 skills com frontmatter válido.
- TOML: 4 agents parseados com `tomllib`.
- links: 14 Markdown alterados verificados, sem target local ausente.
- `codex --strict-config doctor --summary --no-color`: 17 checks ok, 1 idle,
  nenhum warning/fail no mobile e no workspace.
- `graphify hook status`: `post-commit` e `post-checkout` instalados; merge driver
  não registrado.
- `npm test -- --runInBand`: 56/56 suítes e 623/623 testes passaram.
- Código de produção, testes de produto, dependências e lockfile: não alterados.

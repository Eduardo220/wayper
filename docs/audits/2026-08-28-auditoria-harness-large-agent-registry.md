# Auditoria do Harness Wayper para Large Agent Registry

> **Status:** concluída
> **Data:** 2026-08-28
> **Natureza:** auditoria e planejamento; snapshot não normativo
> **Escopo:** Wayper workspace, wayper mobile, wayper-site, configuração Codex
> global relevante, Graphify e evidências históricas
> **Owner normativo atual:** docs/ai/harness-v1.md
> **Branch/HEAD mobile auditados:** develop /
> 34e425ba9d964c51c5fb45df99ac3c4fab7401a1
> **Branch/HEAD site auditados:** dev /
> 08e41ced27f17567cca1f16b6071b5f9c7af3179

Este documento materializa a auditoria read-only concluída anteriormente. Sua
criação ocorreu depois da janela auditada e constitui a única mudança
intencional desta materialização. Código, Harness, configuração, skills, hooks,
dependências e o repositório wayper-site não foram alterados.

## Legenda de evidência

- **CONFIRMED:** observado em source, configuração ou comando read-only.
- **INFERRED:** dedução apoiada pelas evidências, sem enforcement ou medição
  direta suficiente.
- **PROPOSED:** arquitetura futura; não representa estado implementado.

## 1. Executive verdict

**CONFIRMED.** O Wayper já possui uma boa fundação para many available, few
relevant: 56 capabilities em registry on-demand, cinco skills móveis, quatro
reviewers móveis read-only, Working Context com fingerprints, routing
progressivo, handoffs bounded e um backstop de conclusão.

Quase toda decisão operacional ainda depende do comportamento do LLM:
classificação, risk flags, domínio, skill, Graphify, spawn, reviewer, one-writer
e conclusão semântica. O próprio Harness declara que não existe router, planner
ou orchestrator executável em docs/ai/harness-v1.md:48-53 e
docs/ai/orchestration.md:11-14.

Estado observado:

- cinco TOMLs físicos: quatro móveis e um web no agregador;
- quatro custom agents discoverable na sessão mobile;
- 56 capabilities, 12 domínios e 21 assets no registry;
- cinco skills móveis e duas skills web de compatibilidade no root;
- zero writers, testers ou validators custom;
- um gate runtime de projeto: hook Stop;
- zero router semântico executável;
- zero schema machine-validated de handoff;
- zero cache Graphify por Goal;
- quatro slots totais observados: principal mais até três filhos;
- wayper-site sem .codex próprio;
- Brain, tiers T0-T3 e agent benchmarks somente históricos.

**INFERRED.** A distância para a arquitetura desejada não é a falta de agentes.
São cinco camadas ausentes: registry de profiles, matching determinístico,
context packets, handoff validado e gates mecânicos.

**PROPOSED.**

- mínimo justificado: 14 profiles;
- recomendado agora: 35;
- máximo justificável pela arquitetura atual: 41;
- 80-100+ somente quando novas capabilities reais e benchmarks de metadata
  sustentarem a expansão.

A arquitetura recomendada é:

    Capability Registry JSON v2
      -> deterministic capability matcher
      -> one CONTEXT_MAP per Goal
      -> small per-agent packets
      -> native role or bounded TOML profile
      -> JSON handoff validated on SubagentStop
      -> execution waves under the physical thread cap

Não se recomenda Control Tower, provider externo, vector DB, daemon ou reescrita
do Harness nesta fase.

## 2. Current architecture

    USER GOAL
       |
       v
    Native Codex Goal ---------------------------------- RUNTIME
       |
       +--> wayper-context-efficiency trigger ---------- LLM/POLICY
       |       |
       |       +--> .wayper-context/<goal>.md
       |       +--> fingerprints/ranges/diffs ----------- SCRIPT
       |       +--> reuse/read/stop interpretation ------ LLM
       |
       v
    TASK_MODE or META_GOAL_MODE ------------------------- LLM
       |
       v
    Class + CRITICAL_RUNTIME + risk flags --------------- LLM
       |
       +--> current diff / changed scope
       +--> Q0-Q3 quality level -------------------------- LLM
       +--> R0-R3 review level --------------------------- LLM
       |
       v
    Pass 1: domain/capability/skill candidates ----------- LLM
       |
       v
    Source/callers/tests dependency walk ----------------- LLM + TOOLS
       |
       v
    Pass 2: Context Closure
       |
       +--> capability-registry.json --------------------- DATA
       +--> compose explicit capabilities/assets --------- SCRIPT
       |      inputs already chosen by LLM
       |
       +--> optional targeted Graphify ------------------- LLM/POLICY
       |
       v
    Orchestration gate
       |
       +--> S0 main investigates/writes/validates
       +--> S1 one specialist
       +--> S2 parallel read-only specialists
       +--> S3 native workers on disjoint writes --------- POLICY
       |
       v
    Main receives summaries, verifies and deduplicates
       |
       v
    Targeted tests / FAST or DEEP validation
       |
       v
    Stop hook -> deterministic backstop ----------------- SCRIPT/RUNTIME
       |
       v
    Semantic completion + final response ---------------- LLM

O fluxo está documentado em docs/ai/harness-v1.md:22-40. S0 é o default em
docs/ai/orchestration.md:59-69.

### Respostas operacionais

| Pergunta | Estado atual |
| --- | --- |
| Quem decide spawn? | LLM principal; usuário ou instrução também pode exigir. |
| Como decide? | Classes, risk flags, gate S0-S3 e valor esperado, todos declarativos. |
| Quanto é determinístico? | Scope Git, closure já escolhida, fingerprints, parte dos quality gates e cap físico. |
| Quanto depende do LLM? | Intenção, classe, flags, domains, skills, Graphify, candidates, spawn, review e completion semântica. |
| Existe hard-runtime enforcement? | Sandbox read-only e hook Stop; restante majoritariamente policy. |
| Quem controla concorrência? | Runtime Codex; main monta waves. |
| Quem controla recursion? | Policy max_depth=1; não existe config/gate confirmada. |
| Como one-writer é garantido? | Contrato ONE_FILE + ONE_WRITER + PER_WAVE; sem lease/scheduler. |
| O MASTER escreve? | Sim. Em S0, o principal investiga, altera e valida. |
| Como resultados voltam? | Resultado nativo para o principal, que sintetiza. |
| Existe polling? | Não há poller ou daemon de projeto; main pode usar wait nativo. |
| Existe event-driven? | Codex expõe SubagentStart/Stop; projeto não os usa semanticamente. |
| Existe schema formal? | Contrato textual, sem JSON Schema. |
| Handoff malformado? | Main precisa detectar e pedir correção; nenhum validator bloqueia. |

## 3. Current agent inventory

### Totais

| Classe | Quantidade |
| --- | ---: |
| TOMLs físicos no workspace | 5 |
| Custom profiles discoverable na sessão mobile | 4 |
| Profile web de compatibilidade fora da sessão | 1 |
| Inválidos confirmados | 0 |
| Idle/pending consolidation | 1 |
| Horizontais/generalistas custom | 0 |
| Especialistas/reviewers | 5 |
| Validators/testers custom | 0 |
| Writers custom | 0 |
| Roles nativas | default, explorer, worker |

Não existe diretório global ~/.codex/agents. O wayper-site também não possui
.codex. O root declara que o profile web está pendente de consolidação e que
Brain/tiers não são policy ativa em
/home/eduardo/Wayper/.codex/agents/README.md:3-8.

Propriedades comuns:

- model e model_reasoning_effort ausentes nos cinco TOMLs;
- configuração efetiva observada: gpt-5.6-sol / xhigh por herança de
  ~/.codex/config.toml:1-2;
- nenhuma allowlist explícita de tools, MCP ou skills;
- sandbox_mode read-only;
- escrita negada pelo sandbox;
- spawn proibido por instrução, mas não removido mecanicamente do runtime;
- responsabilidade exclusiva somente como lente de review, não ownership de
  path;
- frequência de ativação não possui telemetria.

| ID / TOML | Papel, domínio e trigger | Skills e exclusões | Handoff, caller e overlap | Custo proxy esperado |
| --- | --- | --- | --- | ---: |
| wayper_concurrency_reviewer | Race, ordering, cancellation, registration, single-flight e idempotência. | Active-run ou persistence conforme path; exige interleaving concreto. | Main chama; findings textuais; overlap com persistence/lifecycle. | TOML 704 B; + skill 639-1.056; + Ponytail potencial 1.660. |
| wayper_geospatial_reviewer | GPS, distance, coordinate, geometry, Turf, MapLibre-data e territory. | Active-run para GPS vivo; territory-map para território; sem styling. | Main chama; overlap com lifecycle no GPS vivo. | TOML 804 B; + skill 742-1.056. |
| wayper_mobile_lifecycle_reviewer | Permissions, AppState, background/foreground, recovery, task/headless/native boundary. | Active-run; shell somente na entrada. | Main chama; overlap com concurrency/persistence em recovery. | TOML 729 B; + skill 639-1.056. |
| wayper_persistence_reviewer | Durable save, finalization, migration, queue, retry/replay e idempotência. | Somente persistence-sync; sem UI/storage-neutral work. | Main chama; overlap com concurrency/lifecycle no finish. | TOML 683 B; + skill 783. |
| wayper_web_performance_reviewer | SSR/hydration, motion cleanup, Canvas/WebGL, loading/context loss e performance concreta. | Somente site-motion-webgl; normalmente sem Graphify. | Schema próprio; main chama; distinto dos profiles móveis. | TOML 1.209 B; + skill/refs 505. |

Evidência dos TOMLs:

- .codex/agents/wayper_concurrency_reviewer.toml:1-6;
- .codex/agents/wayper_geospatial_reviewer.toml:1-6;
- .codex/agents/wayper_mobile_lifecycle_reviewer.toml:1-6;
- .codex/agents/wayper_persistence_reviewer.toml:1-6;
- /home/eduardo/Wayper/.codex/agents/wayper_web_performance_reviewer.toml:1-6.

## 4. Current context architecture

| Mecanismo | Classificação | Evidência |
| --- | --- | --- |
| Working Context persistido | IMPLEMENTED_SCRIPT | scripts/wayper-context.mjs:253-271 |
| SHA-256 por arquivo/range | IMPLEMENTED_SCRIPT | scripts/wayper-context.mjs:41-67 |
| Invalidação localizada | IMPLEMENTED_SCRIPT | scripts/wayper-context.mjs:133-181 |
| KNOWN_GOOD_UNCHANGED | IMPLEMENTED_SCRIPT | refresh compara fingerprint e estado |
| REUSE_BEFORE_READ | IMPLEMENTED_POLICY | agent interpreta o status |
| DIFF_BEFORE_FILE | PARTIAL | helper gera diff; não impede full read |
| STOP_WHEN_PROVEN | PARTIAL | scripts/wayper-context.mjs:99-107; não termina Goal |
| Working Context automático | IMPLEMENTED_POLICY | skill manda executar; não há manager/hook |
| Budgets por classe | PARTIAL | scripts/wayper-context.mjs:10-17; proxy sem runtime cap |
| Context routing semântico | DOCUMENTED_ONLY | nenhum classifier executável |
| Capability closure | PARTIAL | scripts/quality/check-capability-routing.mjs:189-240 |
| Contexto por domínio | PARTIAL | registry/docs existem; seleção inicial é LLM |
| Brief mínimo | IMPLEMENTED_POLICY | docs/ai/token-economy.md:118-141 |
| Delta-only entre waves | IMPLEMENTED_POLICY | docs/ai/orchestration.md:242-260 |
| Graphify targeted | PARTIAL | tool + policy; sem integração |
| Graphify incremental | IMPLEMENTED_POLICY | skill instrui update manual |
| Cache/subgraph por mission | NOT_IMPLEMENTED | nenhuma estrutura encontrada |
| Context Map compartilhado | NOT_IMPLEMENTED | cada consumer redescobre ou recebe texto |
| Repo memory | PARTIAL | index existe com zero entries |

Existe um único Working Context no disco, pertencente a Goal anterior. A
auditoria não criou/refrescou outro por ser read-only.

### Graphify

**CONFIRMED.**

- versão 0.9.38;
- root /home/eduardo/Wayper;
- 962 files, 7.307 nodes, 15.535 edges e 442 communities;
- nodes: wayper 4.321; wayper-site atual 683; clone debug 1.048; backup do site
  1.042; backups 167;
- manifest: 403 files mobile, 169 do site atual, 335 de clones e 66 de backups;
- built_at_commit 3737f4634e001389362a2d3fb428bf250e0c45a1, ancestral do
  HEAD mobile;
- working tree posterior e dirty;
- nenhum hook Git Graphify nos dois repositórios;
- nenhuma integração executável em .codex, package.json ou scripts;
- query da auditoria não alterou hashes do graph.

Respostas:

1. Router usa Graphify antes de spawn? Pode, por policy; não automaticamente.
2. Resultado é reutilizado? Não existe mecanismo.
3. Cada agent pode repetir a query? Sim; policy pede evitar, sem bloqueio.
4. Há subgraph por mission? Não.
5. Pode existir CONTEXT_MAP único? Sim, sobre o Working Context atual.
6. Mudanças necessárias? Target por repo, excluir backups/clones, fingerprint da
   query/graph e source confirmations no Goal.

Evidência: /home/eduardo/Wayper/graphify-out/GRAPH_REPORT.md:3-10 e
/home/eduardo/Wayper/graphify-out/graph.json:266128.

### Skills

| Skill | Estado e tamanho | Scope/overlap | Recomendação |
| --- | ---: | --- | --- |
| wayper-active-run | ativa; 4.223 B/91/~1.056 | Live run, GPS lifecycle, background, recovery e finish. | Manter; extrair refs só após benchmark. |
| wayper-persistence-sync | ativa; 3.129 B/72/~783 | Durable save, queue, sync, migration. | Preservar. |
| wayper-territory-map | ativa; 2.966 B/69/~742 | Geometry, territory e MapLibre-data. | Preservar. |
| wayper-mobile-shell | ativa; 2.554 B/63/~639 | Bootstrap, auth gate, navigation e permissions. | Preservar. |
| wayper-context-efficiency | ativa em Goals; 7.391 B/158/~1.848 | Fingerprints, Graphify, packets, delta e stop. | Melhor candidata a core menor + refs. |
| wayper-site-motion-webgl | compatibilidade; body+refs 2.018 B/~505 | Motion, GSAP e Canvas/WebGL. | Consolidar no site. |
| wayper-site-design-content | compatibilidade; body+refs 2.069 B/~518 | Tokens, content, SEO/public contract. | Consolidar no site. |
| wayper-brain | arquivada; 29.807 B/604/~7.452 | Antigo master/router/model ladder. | Não reativar. |

O Brain existe apenas no backup e o root proíbe recriá-lo em
/home/eduardo/Wayper/AGENTS.md:30-32.

## 5. Current routing

O routing vigente não usa T0-T3. Esses tiers pertencem ao Brain/benchmark
arquivados. A foundation atual usa:

- classe: TRIVIAL, BOUNDED, INVESTIGATION, BUG, ARCHITECTURAL;
- override: CRITICAL_RUNTIME;
- contexto: LEVEL 1-4;
- quality/review: Q0-Q3 e R0-R3;
- orchestration: S0-S3.

O Brain/router central foi rejeitado em docs/ai/task-classification.md:134-145.

| Decisão | Tipo atual |
| --- | --- |
| TASK vs META | LLM_BEHAVIORAL |
| Classe primária | LLM_BEHAVIORAL |
| CRITICAL_RUNTIME | LLM_BEHAVIORAL |
| Risk flags | LLM_BEHAVIORAL |
| Changed files/scope no backstop | DETERMINISTIC |
| Domain routing | LLM_BEHAVIORAL |
| Capability closure | HYBRID |
| Skill routing | LLM_BEHAVIORAL |
| Graphify routing | LLM_BEHAVIORAL |
| Q0-Q3 | LLM_BEHAVIORAL |
| R0-R3 | LLM_BEHAVIORAL |
| Reviewer selection | LLM_BEHAVIORAL |
| Mapper/debugger/native role | LLM_BEHAVIORAL |
| Model/reasoning atual | DETERMINISTIC_INHERITANCE |
| Premium escalation | NOT_IMPLEMENTED_CURRENT |
| Spawn/fan-out | HYBRID |
| One-writer | LLM_BEHAVIORAL |
| Completion | HYBRID |

## 6. Current token economy

Estimativa usada pelo projeto: ceil(bytes/4). Não é receipt do provider.

| Recurso | Linhas | Bytes | Proxy |
| --- | ---: | ---: | ---: |
| Root + mobile AGENTS.md | 94 | 4.554 | 1.139 |
| Quatro TOMLs móveis | 24 | 2.920 | 730 |
| Cinco TOMLs incluindo web | 30 | 4.129 | 1.033 |
| Quatro domain skills móveis | 295 | 12.872 | 3.218 |
| Context-efficiency | 158 | 7.391 | 1.848 |
| Todas as skills móveis | 453 | 20.263 | 5.066 |
| Skills web + refs | 79 | 4.087 | 1.022 |
| Brain arquivado | 604 | 29.807 | 7.452 |
| Todo docs/ai | 7.002 | 346.704 | 86.676 |
| Graphify skill global | 710 | 41.000 | 10.250 |
| Ponytail body global | 120 | 6.637 | 1.660 |
| Contrato textual de handoff | 31 | 596 | 149 |

### Economia já existente

- S0 default;
- skills pequenas e on-demand;
- registry on-demand;
- range/diff antes de file inteiro;
- fingerprint reuse;
- bounded brief e delta-only;
- nenhum transcript/tool diary exigido;
- RTK para output ruidoso;
- Graphify sem rebuild hooks;
- memory vazia por default;
- source confirmation.

### Desperdício residual

1. Spawn pode herdar histórico completo se fork_turns não for reduzido.
2. Reviewers podem reler diff, callers, tests e orchestration.
3. Não existe evidence/filesRead ledger machine-readable.
4. Não existe CONTEXT_MAP compartilhado.
5. Graphify pode ser repetido.
6. Main redescobre ownership durante synthesis.
7. Ponytail pode ser injetado em reviewer read-only.
8. Todos os profiles atuais herdam Sol/xhigh.
9. Skill loading não é comprovadamente compartilhado entre agents.
10. Worker/tester nativo pode receber contexto amplo demais.

### Benchmarks históricos

Não existe .codex/benchmarks ativo. O corpus arquivado usa Codex 0.147.0 e
declara staleness após mudança de Codex/modelo.

- floor bounded: 16,6k-19,3k input;
- diagnósticos abertos: 464k e 581k;
- active-run com skill: 140.741 vs 218.117 sem skill;
- persistence com skill foi pior: 181.599 vs 146.651;
- site motion com skill: 70.752 vs 55.659;
- Graphify para símbolo conhecido: 6,125 s vs rg 0,006 s;
- Caveman: output tokens 185 -> 248;
- concurrency low perdeu lost-update achado por medium.

Reutilizar corpus A-L, usage fields, wall time, tool calls, skill on/off, review
yield, duplicates e quality floor. Não reutilizar model matrix, tiers, Brain,
custos absolutos ou concurrency de seis threads.

Evidência:

- /home/eduardo/Wayper/backups/ai-harness-v1-foundation-20260816-191434/inactive-workspace/generated-stale/benchmarks/baseline.md:17-48;
- /home/eduardo/Wayper/backups/ai-harness-v1-foundation-20260816-191434/inactive-workspace/generated-stale/benchmarks/comparisons.md:24-69.

## 7. Hard-runtime gaps

| Regra | Estado atual | Runtime gate possível |
| --- | --- | --- |
| Reviewer read-only | Hard | Preservar sandbox read-only. |
| One-writer | Policy | Writer lease por path/owner/wave. |
| No recursion/max depth 1 | Policy | Tool restriction quando suportada + SubagentStart audit. |
| Skill gates | Policy | Router entrega assets permitidos e validator verifica closure. |
| Model/reasoning | Herança global | Fixar no TOML somente após benchmark. |
| Premium escalation | Ausente | Risk flag + evidence + escalation reason. |
| Final reviewer | Policy | Dependency obrigatória pela risk matrix. |
| Graphify-first seletivo | Policy | Registrar graphifyDecision, sem torná-lo universal. |
| No Git automático | Policy/approval | Sandbox/command policy nos filhos. |
| Stop conditions | Partial | Preservar Stop e validar evidence ledger. |
| Context budget | Proxy | Packet builder bloqueia over-budget sem reason. |
| Delta-only | Policy | Packet builder aceita learningDelta, não history. |
| Handoff schema | Texto | JSON Schema + SubagentStop validation. |
| filesChanged em read-only | Policy + sandbox | Validator exige array vazio. |
| No redundant agent | Policy | Overlap/covered-capability gate. |
| Registry/TOML drift | Ausente | Validator cruza IDs, paths, model e sandbox. |

O hook atual está em .codex/hooks.json:1-13 e chama
scripts/quality/check-completion-backstop.mjs:89-126. Hooks são guardrails e não
uma security boundary completa.

## 8. Scalability assessment

### Catálogo versus execução

| Escala | Somente registrada | Todos spawnados |
| --- | --- | --- |
| 30 | Metadata linear provavelmente aceitável, ainda a medir. | Exige waves; não cabe nos três child slots. |
| 50 | Registry continua pequeno; tool-schema metadata torna-se material. | Não deve ocorrer por default. |
| 80 | Disco/config irrelevantes; descriptions podem custar milhares de tokens. | Centenas de milhares de tokens duplicados. |
| 100+ | Plausível como catálogo; discoverability precisa benchmark. | Só para auditoria ampla em waves. |

O registry atual ocupa aproximadamente 223 B por capability. Cem capabilities
seriam cerca de 22 kB quando o registry fosse aberto. Um TOML atual ocupa em
média 826 B; cem TOMLs físicos seriam cerca de 83 kB. O quanto disso entra no
prompt bootstrap não está documentado e precisa ser medido.

Não existe [agents] na configuração do projeto/global. O cap pertence ao runtime
e a sessão observada ofereceu quatro slots totais.

### Princípios Overclock

| Conceito | Estado |
| --- | --- |
| Agent arsenal | PARTIAL |
| Capability specialization | PARTIAL |
| Mission isolation | PARTIAL |
| Harness por task | PARTIAL |
| Skill gates | PARTIAL |
| Deterministic routing | PARTIAL |
| Recipes/process workflows | ALREADY_HAVE |
| Event-driven handoffs | PARTIAL |
| Worktree isolation | FUTURE |
| Observability | PARTIAL |
| Cost visibility | PARTIAL |
| Coordinator separado | PARTIAL |
| Cockpit/control tower | NOT_NEEDED |

## 9. Proposed capability registry

**PROPOSED.** Manter JSON como formato canônico:

- já é usado pelo projeto;
- validator atual usa Node stdlib;
- é deterministicamente parseável;
- YAML acrescentaria parser/dependência;
- TOML deve conter somente configuração suportada pelo Codex;
- registry gerado criaria segunda fonte de verdade.

Estrutura:

    {
      "schemaVersion": 2,
      "domains": [],
      "assets": [],
      "capabilities": [],
      "agentProfiles": [
        {
          "id": "active-run-recovery-finish-reviewer",
          "domain": "RUN_RUNTIME",
          "subdomain": "recovery-finish",
          "capabilities": [
            "active-run-recovery",
            "run-finish-handoff",
            "run-finalization"
          ],
          "activationSignals": {
            "riskFlags": ["LIFECYCLE", "RUN_DATA_LOSS"],
            "paths": ["src/services/run/**", "src/services/runTracking/**"]
          },
          "ownedPaths": [],
          "relatedPaths": [],
          "skills": ["wayper-active-run", "wayper-persistence-sync"],
          "graphifyQueries": [],
          "nativeRole": "explorer",
          "tomlProfile": null,
          "writePermission": "none",
          "sandbox": "read-only",
          "modelPolicy": "inherit-until-benchmarked",
          "reasoningPolicy": "risk-selected",
          "handoffSchema": "wayper-handoff-v1",
          "exclusions": [],
          "conflicts": [],
          "prerequisites": [],
          "validators": [],
          "estimatedContextCost": {
            "packetTokenProxy": 2400
          }
        }
      ]
    }

Separação:

- capabilities = conhecimento/coverage;
- agentProfiles = capacidade operacional;
- TOML = sandbox/model/reasoning/instrução runtime;
- native role + packet = default quando não há necessidade de profile hard;
- skill/reference = conhecimento reutilizável;
- source/tests = verdade.

## 10. Proposed router

Algoritmo:

1. Fingerprint de repo, branch/HEAD, operation, class, risks, changed files, diff
   e dirty state.
2. Matches determinísticos de paths, ownership, tests, manifests, operation e
   exclusions.
3. Remover coverage já provada e KNOWN_GOOD_UNCHANGED.
4. Usar registry suggests apenas como candidates.
5. Fazer source dependency walk.
6. Usar uma query Graphify targeted apenas com structural uncertainty.
7. Pontuar:

       score =
         path_match
       + capability_match
       + risk_coverage
       + dependency_coverage
       + expected_information_gain
       - overlap
       - conflict
       - context_cost
       - already_covered_capability

8. Resolver weighted set-cover das capabilities obrigatórias.
9. Adicionar prerequisites e validators.
10. Parar sem MAX_AGENTS quando coverage estiver completa e information gain
    marginal não superar custo.
11. Ordenar DAG pelo cap físico.
12. Usar model judgment apenas no residual ambíguo.

| Decisão | Futuro |
| --- | --- |
| Path ownership, changed files e diff | DETERMINISTIC |
| Exclusions/conflicts/prerequisites | DETERMINISTIC |
| Known-good/fingerprint | DETERMINISTIC |
| Capability coverage/overlap | DETERMINISTIC |
| Write conflicts/waves | DETERMINISTIC |
| Schema/context budget | DETERMINISTIC |
| Keywords/signals | DETERMINISTIC, peso baixo |
| Root cause desconhecida | MODEL_JUDGMENT |
| Product intent | MODEL_JUDGMENT |
| Dependency dinâmica | MODEL_JUDGMENT + SOURCE |
| Conflicting evidence | MODEL_JUDGMENT |
| Specialist adicional | HYBRID |

O router deve começar em shadow mode.

## 11. Proposed agent taxonomy

Profiles representam capabilities disponíveis e não precisam virar TOML
imediatamente.

| ID | Scope e paths prováveis | Exclusão/diferença | Ativação |
| --- | --- | --- | --- |
| harness-registry-reviewer | Registry, schema e drift em docs/ai/capability-* | Não executa routing | Registry/profile change |
| harness-router-eval-reviewer | Precision/recall, false routing e evals | Não revisa hooks | Matcher/eval change |
| harness-context-efficiency-reviewer | Fingerprints, invalidation, packets e budgets | Não é router geral | Context change |
| harness-handoff-gate-reviewer | Hooks, schemas e completion | Não revisa produto | Hook/handoff change |
| mobile-bootstrap-provider-reviewer | App.js, index.js e providers | Não cobre active-run interno | Bootstrap/provider |
| mobile-auth-permission-reviewer | Auth gate, permissions e identity | Não cobre run sync | Auth/session/permission |
| mobile-navigation-deeplink-reviewer | Navigation, deep links e root routes | Sem local styling | Navigation contract |
| active-run-state-machine-reviewer | runTracking, transitions e pause/resume | Sem geometry detalhada | State transition |
| wayper-concurrency-reviewer | Race/order/single-flight | Exige interleaving | CONCURRENCY |
| wayper-mobile-lifecycle-reviewer | App/background/headless/recovery | Sem persistence puro | LIFECYCLE/NATIVE |
| active-run-notification-reviewer | Notification actions/channels/foreground | Não é build reviewer | Notification change |
| active-run-recovery-finish-reviewer | Recovery, finish e minimum-save handoff | Sem queue inteira | Recovery/finalization |
| active-run-gps-quality-reviewer | Samples, filters, accuracy e distance | Diferente de territory geometry | GPS ingestion |
| wayper-persistence-reviewer | Durable save/finalization | Sem migration profunda automática | Data durability |
| storage-migration-reviewer | AsyncStorage/SQLite/schema compatibility | Sem queue sem migration | Persisted schema |
| deferred-queue-replay-reviewer | Queue/retry/replay/idempotency | Sem Firebase Auth | Queue/sync |
| firestore-sync-consistency-reviewer | Local/remote consistency | Auth fica em security | Firestore write/sync |
| wayper-geospatial-reviewer | Route/coordinate/geometry | Live GPS pode usar profile específico | GPS_GEO/TERRITORY |
| territory-capture-reviewer | Eligibility, anti-fraud e polygons | Sem repository sozinho | Capture/rules |
| territory-repository-reviewer | Storage/migration/replay | Sem render/style | Territory storage |
| maplibre-data-boundary-reviewer | GeoJSON, coordinate order e adapters | Não é visual design | Map data boundary |
| progression-rewards-reviewer | XP, achievements e economy | Sem ranking completo | Progression |
| ranking-consistency-reviewer | Weekly/monthly/local ranking | Sem relationships | Ranking aggregation |
| social-relationship-reviewer | Friends/groups/membership/authz | Sem feed rendering | Relationship change |
| feed-profile-reviewer | Feed/profile/local stats | Sem ranking algorithm | Feed/profile |
| mobile-accessibility-design-reviewer | Theme, layout, motion e a11y | Sem lifecycle/geo ownership | Cross-screen visual |
| diagnostics-privacy-reviewer | Logs, export/upload, Sentry e sensitive data | Não é debugger genérico | Diagnostics/telemetry |
| mobile-performance-reviewer | Render/write frequency, memory e hot paths | Exige risk/measurement | PERFORMANCE |
| trust-boundary-security-reviewer | Authz, input, secrets, URLs/deep links | Não ativa por palavra Firebase | AUTH_SECURITY |
| android-native-runtime-reviewer | Manifest, task/service/receiver/Gradle | Sem JS UI | Native Android |
| test-impact-validator | Changed files para suites/gaps | Não decide produto | Nontrivial write |
| build-release-config-validator | Expo/EAS/package/Gradle/release | Não faz deploy | Build/release config |
| architecture-boundary-reviewer | Ownership/import boundaries/migration | Não substitui domain specialist | Cross-domain boundary |
| wayper-web-performance-reviewer | Motion/WebGL/performance | Sem SEO/copy | Site motion/Canvas |
| web-public-contract-accessibility-reviewer | App Router, SEO, metadata, content e a11y | Sem WebGL internals | Public site contract |

Contagens:

- mínimo 14;
- recomendado 35;
- máximo hoje 41, separando seis profiles compostos;
- nenhum iOS specialist sem source/owner/config iOS real;
- researcher, implementer e reviewer genérico permanecem roles nativas.

## 12. Proposed context packets

### CONTEXT_MAP por Goal

Persistir sobre o Working Context:

- goal/repo/HEAD/dirty fingerprint;
- task fingerprint;
- changed files e diff hash;
- required capabilities;
- candidates/selected/excluded + scores;
- source evidence refs com path/range/symbol/hash;
- dependency edges e provenance;
- Graphify version/scope/query/result fingerprint;
- known-good artifacts;
- risk flags/invariants;
- validation plan;
- learning delta.

Packet por specialist:

    {
      "schemaVersion": 1,
      "goalId": "",
      "taskId": "",
      "agentId": "",
      "objective": "",
      "capabilities": [],
      "scope": {"paths": [], "symbols": []},
      "exclusions": [],
      "riskFlags": [],
      "invariants": [],
      "diff": {"hash": "", "paths": []},
      "evidenceRefs": [],
      "knownGoodRefs": [],
      "learningDelta": [],
      "allowedGraphifyQueries": [],
      "validation": [],
      "contextTokenCeiling": 0,
      "handoffSchema": "wayper-handoff-v1"
    }

Regras:

- nunca enviar Working Context inteiro;
- não colar source abrível por path/range;
- deduplicar assets por hash;
- fornecer ownership/dependencies já comprovados;
- reviewers independentes verificam diff/source sem receber conclusões alheias;
- nova dependency retorna delta;
- over-budget exige reason e nunca remove evidence necessária.

## 13. Proposed handoff protocol

JSON puro é recomendado.

    {
      "schemaVersion": 1,
      "agent": "",
      "task": "",
      "status": "DONE",
      "confidence": 0.9,
      "coverage": [],
      "findings": [],
      "evidence": [],
      "risks": [],
      "recommendations": [],
      "filesRead": [],
      "filesChanged": [],
      "tests": [],
      "unvalidated": [],
      "blockers": []
    }

Contrato:

- um objeto JSON, sem transcript;
- evidence com path, line, symbol, claim e sourceHash;
- finding exige severity, scenario, impact, safeguard e confidence;
- read-only exige filesChanged vazio;
- status enum;
- limite de bytes por profile;
- recommendations não autorizam writes.

Fluxo event-driven:

1. SubagentStop entrega último assistant message.
2. Validator faz parse/schema check.
3. Handoff inválido recebe uma correção bounded.
4. Segunda falha vira INVALID_HANDOFF.
5. Main replana ou continua sem aquela evidence.
6. Sem polling custom ou event bus externo.

## 14. Proposed execution model

    WAVE A - DISCOVERY
      deterministic router
      source ownership/dependency
      optional targeted Graphify
      maximum 3 concurrent read-only tasks

    WAVE B - SPECIALISTS
      selected by uncovered capabilities
      repeated waves under child-slot cap

    WAVE C - WRITE
      S0/main or one native worker
      serial by default
      parallel only with write leases/worktrees

    WAVE D - VALIDATION/REVIEW
      test-impact validator
      risk-selected specialists
      final reviewer only by matrix

    WAVE E - SYNTHESIS
      main deduplicates, confirms and completes

O catálogo pode conter qualquer quantidade conceitual. Apenas simultaneidade,
conflito e redundancy são limitados.

## 15. Preserve / Change / Remove

| Ação | Mecanismo |
| --- | --- |
| PRESERVE_AS_IS | Source/test/config acima de graph/map/cache |
| PRESERVE_AS_IS | S0 default |
| PRESERVE_AS_IS | Specialists read-only |
| PRESERVE_AS_IS | Main como único orchestrator/synthesizer |
| PRESERVE_AS_IS | Skills atuais |
| PRESERVE_AS_IS | Graphify targeted sem Git hooks |
| PRESERVE_AS_IS | Fingerprints/range/local invalidation |
| PRESERVE_AS_IS | Bytes/4 separado de billing |
| PRESERVE_AS_IS | Stop completion backstop |
| PRESERVE_CONCEPT_HARDEN | One-writer |
| PRESERVE_CONCEPT_HARDEN | max_depth=1 |
| PRESERVE_CONCEPT_HARDEN | Bounded/delta handoffs |
| PRESERVE_CONCEPT_HARDEN | Context budgets |
| CHANGE | Registry v2 |
| CHANGE | Deterministic routing |
| CHANGE | Working Context com CONTEXT_MAP |
| CHANGE | Graphify target por repo e sem clones/backups |
| CHANGE | Site harness repo-local |
| CHANGE | Model inheritance após benchmark |
| REMOVE_FROM_CURRENT_DECISIONS | Brain e tiers arquivados |
| REMOVE_FROM_GRAPH_SCOPE | Backups e clones |
| REMOVE_AFTER_CONSOLIDATION | Compatibility resources no root |
| NOT_NEEDED | Control Tower, daemon, vector DB e provider externo |

## 16. Migration plan

| Fase | Entrega | Dependência | Risco/impacto |
| --- | --- | --- | --- |
| 0 | Auditoria e baseline | - | Sem mudança operacional |
| 1 | Registry JSON v2 + validator registry/TOML | 0 | Baixo; shadow |
| 2 | Deterministic matcher em shadow mode | 1 | False routing |
| 3 | CONTEXT_MAP + packet builder | 2 | Stale evidence/budgets |
| 4 | Handoff JSON + SubagentStop validator | 3 | Schema overhead |
| 5 | Write leases, conflicts, model/profile e validators | 1-4 | Hooks não são security boundary |
| 6 | Execution waves | 2-5 | Shared checkout |
| 7 | Expandir 5 -> 14 -> 35 profiles | 1-6 | Medir yield/overlap |
| 8 | Benchmarks atuais Codex/model | 2-7 | Necessário para tuning |
| 9 | Mission/worktree isolation | Evidência de S3 | Somente writers paralelos |
| 10 | Cockpit/processos independentes | Métricas maduras | Não antecipar |

Cada fase deve passar por shadow -> warning -> selective enforcement -> blocking.

## 17. Token impact

Valores em milhares de token-proxy; não incluem system prompt, cache, reasoning
ou billing.

| Cenário | Atual amplo | Futuro ruim: 80 agents | Futuro correto | Agents corretos | Duplicação / handoff |
| --- | ---: | ---: | ---: | ---: | ---: |
| Alteração trivial | 2 | 320 | 2 | 0 | 0 / 0 |
| Bug localizado | 20-40 | 480 | 10-14 | 1 | <1 / 0,2 |
| Bug active-run complexo | 80-250 | 640 | 25-40 | 4-6 | 1-3 / 1-2 |
| Feature cross-domain | 120-350 | 800 | 45-75 | 7-10 | 3-6 / 2-4 |
| Architectural audit | 200-600 | 1.200 | 80-140 | 12-18 | 8-15 / 5-10 |

O número de agents cresce com coverage real. O contexto compartilhado não.

## 18. Risks

1. Metadata de 80-100 profiles pode crescer linearmente.
2. Keywords/paths isolados geram false routing.
3. Granularidade excessiva duplica findings/leitura.
4. Registry e TOMLs podem divergir.
5. Graphify atual contém clones, backups e WIP posterior.
6. Fingerprint não prova runtime/aparelho/GPS.
7. Working Context pode reutilizar evidence semanticamente stale.
8. JSON handoff pode virar burocracia.
9. Hooks são fail-open/coverage parcial.
10. Shared checkout/index tornam S3 inseguro.
11. Benchmark 0.147 não autoriza tuning atual.
12. Sol/xhigh para todos pode ser caro; downgrade sem benchmark pode perder qualidade.
13. wayper-site ainda não possui Harness repo-local.
14. Ponytail global injeta contexto em agents read-only.
15. Sem provider receipt, economia total continua unknown.
16. Dirty state mobile mudou concorrentemente durante a auditoria.

## 19. Files that would need modification

Existentes:

- docs/ai/capability-registry.json
- docs/ai/capability-routing-evals.json
- docs/ai/capability-architecture.md
- docs/ai/context-routing.md
- docs/ai/orchestration.md
- docs/ai/working-context.md
- docs/ai/hooks-and-gates.md
- docs/ai/quality-gates.md
- docs/ai/token-economy.md
- docs/ai/routing-evals.md
- docs/ai/harness-v1.md
- scripts/quality/check-capability-routing.mjs
- scripts/quality/check-capability-routing.test.mjs
- scripts/wayper-context.mjs
- scripts/quality/check-context-efficiency.test.mjs
- scripts/quality/check-completion-backstop.mjs
- scripts/quality/check-completion-backstop.test.mjs
- package.json
- .codex/hooks.json
- .codex/agents/*.toml
- /home/eduardo/Wayper/AGENTS.md
- /home/eduardo/Wayper/.codex/agents/wayper_web_performance_reviewer.toml
- /home/eduardo/Wayper/.agents/skills/wayper-site-*
- /home/eduardo/Wayper/wayper-site/AGENTS.md

Novos, se adotados:

- scripts/wayper-agent-router.mjs
- scripts/quality/check-agent-registry.mjs
- scripts/quality/check-agent-registry.test.mjs
- scripts/quality/check-agent-handoff.mjs
- scripts/quality/check-agent-handoff.test.mjs
- docs/ai/agent-handoff-schema.json
- .codex/config.toml
- /home/eduardo/Wayper/wayper-site/.codex/agents/*.toml
- /home/eduardo/Wayper/wayper-site/.agents/skills/**

## 20. Final recommendation

Arquitetura exata:

    capability-registry.json v2
      = canonical capability + agent metadata

    .codex/agents/*.toml
      = only profiles requiring runtime sandbox/model/instructions

    native roles + capability packets
      = default instantiation mechanism

    deterministic router
      = paths/diff/risk/dependencies/known-good/overlap/cost

    model judgment
      = ambiguity, root cause, conflicting evidence, product intent

    Working Context
      = existing persistence plus one Goal-scoped CONTEXT_MAP

    Graphify
      = one targeted, repo-scoped, fingerprinted discovery source

    handoff
      = one versioned JSON object validated on SubagentStop

    execution
      = unlimited conceptual catalog, relevance-selected active set,
        physical waves under the runtime cap

    writes
      = main/one writer by default; leases/worktrees only when justified

Expandir primeiro para 14 e medir; depois para 35 e medir. O máximo 41 é uma
fronteira de justificativa arquitetural do snapshot atual, não um limite do
sistema. O registry pode ultrapassar 80/100 quando novas capabilities reais
aparecerem, sem mudar o algoritmo.

## Diagnósticos executados na auditoria

- Codex 0.149.1;
- codex doctor --strict-config --json com config válida;
- reachability do provider indisponível sob sandbox de rede;
- zero MCP servers configurados;
- Graphify 0.9.38;
- uma query Graphify read-only com hashes antes/depois idênticos;
- nenhum teste de projeto, pois as suítes criariam fixtures temporárias;
- nenhum agent/subagent criado.

## Safety check da janela auditada

| Verificação | Resultado |
| --- | --- |
| source changed pela auditoria? | NO |
| Harness changed? | NO |
| .codex changed? | NO |
| .agents changed? | NO |
| docs changed? | NO |
| dependencies changed? | NO |
| global config changed? | NO |
| commits created? | NO |
| push/fetch/pull/merge/rebase? | NO |
| worktree created? | NO |
| original dirty state preserved? | NO; divergência concorrente detectada |

Comparação:

| Repo/escopo | Inicial | Final da auditoria |
| --- | --- | --- |
| wayper | develop; HEAD 34e425ba; status SHA 442151606947 | mesma branch/HEAD; status SHA 4771132e2bf5 |
| wayper-site | dev; HEAD 08e41ced; status SHA 5ec461c9ebd5 | idêntico |
| Root .codex + .agents | aggregate SHA 0260a8eb2843 | idêntico |
| Mobile Harness/docs/scripts | aggregate SHA 1e1ffdc1e7a0 | idêntico |
| Global config/hooks | fbe5aa3a / c66dba0d | idênticos |
| Graphify core | quatro hashes registrados | idênticos |

O único arquivo dirty com mtime dentro da janela foi
src/screens/MapScreen.js às 18:55:05. O index permaneceu com mtime de 24/08 e o
estado final não possuía diff unstaged. **INFERRED:** um processo concorrente
reescreveu o working file para o conteúdo staged. A auditoria não executou
write, formatter, test, checkout, add ou reversão.

## Fontes principais

- AGENTS.md
- docs/00-fontes-do-projeto.md
- docs/14-instrucoes-para-ia.md
- docs/ai/harness-v1.md
- docs/ai/task-classification.md
- docs/ai/context-routing.md
- docs/ai/capability-architecture.md
- docs/ai/capability-registry.json
- docs/ai/orchestration.md
- docs/ai/quality-gates.md
- docs/ai/working-context.md
- docs/ai/token-economy.md
- docs/ai/hooks-and-gates.md
- docs/ai/meta-goal-runtime.md
- scripts/wayper-context.mjs
- scripts/quality/check-capability-routing.mjs
- scripts/quality/check-completion-backstop.mjs
- .codex/agents/*.toml
- .agents/skills/*/SKILL.md
- /home/eduardo/Wayper/AGENTS.md
- /home/eduardo/Wayper/graphify-out/GRAPH_REPORT.md
- https://developers.openai.com/codex/subagents
- https://developers.openai.com/codex/hooks

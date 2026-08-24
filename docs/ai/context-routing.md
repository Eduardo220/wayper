# Context Routing — Wayper AI Harness V1

> **Status:** vigente<br>
> **Escopo:** seleção mínima de contexto do repositório mobile<br>
> **Owner:** [`docs/ai/harness-v1.md`](harness-v1.md)<br>
> **Classificador:** [`docs/ai/task-classification.md`](task-classification.md)

O router é declarativo. Ele não executa código, não substitui o agente principal
e não autoriza produto. [`docs/00-fontes-do-projeto.md`](../00-fontes-do-projeto.md)
continua sendo o catálogo de autoridade documental; este mapa decide o menor
subconjunto a abrir para a tarefa atual.

## Sequência

1. inferir pela intenção `TASK_MODE` ou `META_GOAL_MODE`; carregar
   [`meta-goal-runtime.md`](meta-goal-runtime.md) somente no segundo;
2. classificar a tarefa e marcar flags semânticas;
3. inspecionar o diff real e selecionar `GATE_LEVEL`/`REVIEW_MODE` por
   [`quality-gates.md`](quality-gates.md);
4. selecionar processo somente quando ele acrescentar disciplina;
5. executar Pass 1: escolher `ENTRY_DOMAIN`, `ENTRY_CAPABILITY` e o menor
   skill/reference do [`capability-registry.json`](capability-registry.json);
6. iniciar no menor context level suficiente e consultar memory somente quando
   task, domínio e risco justificarem;
7. investigar source/callers/testes pelo dependency walk aplicável;
8. executar Pass 2: expandir apenas dependencies confirmadas, classificá-las e
   fechar o minimum sufficient context;
9. usar Graphify ou specialist apenas quando incerteza/risco justificar;
10. escalar ao encontrar risco novo; não rebaixar risco comprovado por padrão.

Palavra não é gatilho: “corrida” em texto não implica `RUN_RUNTIME`; “mapa”
visual não implica `TERRITORY_GEO`; “Firebase” em doc não chama reviewer de
persistência; “teste” não cria agent tester; “meta” citada em copy/source/doc não
ativa `META_GOAL_MODE` sem intenção de outcome contínuo.

## Execution mode gate

| Intenção observada | Mode | Contexto adicional |
| --- | --- | --- |
| objetivo pontual, mesmo grande | `TASK_MODE` | nenhum Goal contract |
| outcome amplo com melhoria iterativa e vários slices | `META_GOAL_MODE` | `meta-goal-runtime.md` |
| palavra “meta” dentro do conteúdo alterado | inferir pelo pedido real | não ativar por keyword |

Meta Goal compõe classifier, processos e domains por slice. Não cria classe,
skill, specialist ou gate de qualidade próprio.

## Capability routing e Context Closure

O contrato, a taxonomia e a política skill-vs-reference pertencem a
[`capability-architecture.md`](capability-architecture.md). O registry é aberto
sob demanda depois que o domínio de entrada foi selecionado; não entra em
`LEVEL 0`.

```text
PASS 1 — INTENT ROUTING
ENTRY_DOMAIN -> ENTRY_CAPABILITY -> ENTRY_SKILL_OR_REFERENCE

PASS 2 — DEPENDENCY EXPANSION
SOURCE DEPENDENCY WALK -> CONFIRMED DEPENDENCIES -> CONTEXT CLOSURE
```

O domínio citado pelo usuário é entrypoint, não veredito de causa. Relações
`suggests`, Graphify e proximidade semântica ajudam discovery, mas não são
percorridas nem carregadas automaticamente. Cada dependency confirmada recebe
`INTERFACE_ONLY`, `BEHAVIOR_RELEVANT` ou `OWNER_CRITICAL`; source atual confirma
qualquer expansão.

Em Meta longa, o working set é recalculado por safe slice. Preserve somente
Learning Delta relevante; uma skill carregada antes não permanece ativa por
inércia. `CAPABILITY_GAP` só é declarado após task + source + registry não
cobrirem o conhecimento/workflow necessário. Discovery externa ainda exige os
seis campos e o pipeline de
[`external-skill-acquisition.md`](external-skill-acquisition.md); sem gap provado,
o router não chama Find Skills nem `skills find`.

## Memory lookup gate

Repo memory é contexto opcional e segue
[`memory-policy.md`](memory-policy.md). Default: `0` bytes.

| Contexto observado | Route |
| --- | --- |
| `TRIVIAL`, copy, styling ou doc pequena | não abrir index/topic |
| `BOUNDED` sem domínio/risco relacionado | não abrir index/topic |
| `BUG`, `INVESTIGATION`, `ARCHITECTURAL`, Meta slice ou `CRITICAL_RUNTIME` relevante | abrir o index pequeno e filtrar por domain + risk |
| 1–3 matches fortes | abrir apenas esses topics |
| muitos matches | refinar; não despejar memória no contexto |

Memory contradita ou com invalidation condition atingida é revalidada contra
source/docs. Em `CRITICAL/HIGH`, confirmar source atual é obrigatório. Palavra
isolada — “corrida”, “Firestore”, “meta” — não cria match sem intenção/domínio.

## Process routing

Carregue [`docs/ai/process-workflows.md`](process-workflows.md) somente quando a
sequência acrescentar disciplina além do classifier/domain skill.

| Sinal | Processo | Composição mínima |
| --- | --- | --- |
| bug verificável | `BUG_INVESTIGATION` | classe + domínio; domain skill/reviewer só por escopo/flags |
| refactor explicitamente behavior-preserving e não trivial | `SAFE_REFACTOR` | classe + owners/consumers + boundaries se cruzar camada; Graphify apenas se mapa amplo |
| mudança de owner/boundary/migration | `ARCHITECTURAL_CHANGE` | classe + domínios + `architecture-boundaries` + decisão/migração |
| falha de teste | `TEST_FAILURE_INVESTIGATION` | `TEST_BUILD` + domínio do contrato afetado |
| feature bounded | workflow nativo | classe + domínio; não criar feature skill genérica |
| code review | contrato nativo de review | specialists somente por risk flag |
| sanitation/document sync | workflow nativo leve | nenhuma process skill |
| critical runtime | workflow de `wayper-active-run` | não criar `wayper-critical-runtime` |

## Orchestration gate

Depois de classificar processo/domínio, permaneça em `S0 — SINGLE` salvo valor
material de isolamento, especialização, paralelismo real ou review independente.
O protocolo completo pertence a
[`docs/ai/orchestration.md`](orchestration.md); este router apenas seleciona o
menor modo.

| Evidência | Route |
| --- | --- |
| tarefa local/bounded sem especialização | `S0` |
| um risco concreto casa com um specialist | `S1` |
| investigações/reviews read-only independentes | `S2` |
| writers independentes, DAG/arquivos/shared resources conhecidos | `S3`, somente com eligibility explícita |

File scope `UNKNOWN`, mesmo arquivo, shared contract, root cause ainda incerta ou
fluxo crítico interdependente impedem write paralelo. `CRITICAL_RUNTIME` prefere
implementação serial e review `S1`/`S2`; specialists continuam selecionados
pelas flags, nunca pela quantidade disponível.

## Level 1 — índice rápido

Leia esta tabela para escolher domínio; abra abaixo somente as seções escolhidas.

| Domain | Sinais semânticos | Exclui por padrão |
| --- | --- | --- |
| `RUN_RUNTIME` | corrida ativa, GPS vivo, pause/resume, recovery, finish | texto/UI/pós-corrida sem lifecycle |
| `MOBILE_SHELL` | bootstrap, auth gate, navegação, onboarding, permissions | runtime/queues internos |
| `PERSISTENCE_SYNC` | save, recovery storage, migration, queue, sync | GPS vivo/UI-only |
| `TERRITORY_GEO` | coordenadas, distância, rota, território, MapLibre data | styling de mapa |
| `FIREBASE_AUTH` | Firebase/Auth/Firestore access/segurança | citação documental |
| `SOCIAL` | feed, friends, groups, profile, ranking | corrida sem integração social |
| `UI_DESIGN` | identidade, layout, type, color, interaction, motion, accessibility, map/gamification visual | copy-only e ownership técnico não visual |
| `DIAGNOSTICS_SENTRY` | logs, diagnóstico, Sentry, performance monitoring | bug apenas investigado no source |
| `ANDROID_NATIVE` | manifest, Kotlin, service, receiver, Gradle | React UI pura |
| `TEST_BUILD` | Jest, build, dependency, Expo/EAS, tooling | mera solicitação de validar |
| `PRODUCT_RULES` | regra, entitlement, economia, direção aprovada | implementação inequívoca |
| `HARNESS_AI` | AGENTS, skill, agent, Codex config, routing | runtime que só usa o Harness |

## Mapa por domínio

Os entry points são rotas de entrada, não listas exaustivas. Source e testes da
branch atual sempre confirmam ownership.

### `RUN_RUNTIME`

- **Triggers:** estado/ciclo de corrida ativa, GPS ingerido ao vivo, duração,
  distância, pause/resume, background, notificação de corrida, recovery ou
  handoff de finish.
- **Negative triggers:** copy/style do botão, UI pós-corrida ou regra derivada
  sem efeito no lifecycle ativo.
- **Entry points:** `index.js`, `src/tasks/activeRunLocationTask.js`,
  `src/services/runTracking/`, `src/services/run/runRecoveryService.js`,
  `src/services/run/runNotificationService.js`, `src/screens/MapScreen.js`.
- **Primary owners:** `activeRunTrackingService`, `activeRunRuntimeService`,
  `activeRunState` e a task headless; `MapScreen` é integração, não owner.
- **Docs:** `docs/04-arquitetura.md`, `docs/wayper/09-arquitetura-tecnica.md`,
  `docs/22-teste-real-corrida-background.md`, `docs/13-bugs-conhecidos.md`.
  Carregue `docs/ai/architecture-boundaries.md` somente se cruzar camada/owner.
- **Tests:** `src/services/runTracking/__tests__/` e testes relacionados em
  `src/services/run/__tests__/`.
- **Skills:** `wayper-active-run`.
- **Specialists:** lifecycle, concurrency, geospatial ou persistence somente
  conforme flags.
- **Tools:** source primeiro; Graphify para impacto/ownership amplo; aparelho
  físico para afirmações de background/tela apagada.
- **Validation:** lifecycle contract, suíte direcionada, save mínimo e matriz
  física quando aplicável.
- **Risk flags:** `RUN_DATA_LOSS`, `LIFECYCLE`, `CONCURRENCY`, `GPS_GEO`,
  `OFFLINE_STORAGE`, `NATIVE_ANDROID`, `PERFORMANCE`.
- **Escalation:** qualquer risco de perda, novo writer/owner, task nativa ou
  estado persistido ativa `CRITICAL_RUNTIME` e pode levar ao nível 4.

### `MOBILE_SHELL`

- **Triggers:** bootstrap, providers, auth gate, navegação raiz, deep link,
  onboarding, permissões e entrada de sessão.
- **Negative triggers:** ingestão GPS, finish/deferred queue ou detalhe interno
  de uma tela já montada sem efeito no shell.
- **Entry points:** `index.js`, `App.js`, `src/navigation/`,
  `src/firebaseConfig.js`, `src/services/auth/`, `src/services/onboarding/` e
  `src/services/permissions.js`.
- **Primary owners:** entrypoint nativo/React, `MainNavigator`, auth, onboarding
  e permissions services.
- **Docs:** `docs/06-fluxos-de-usuario.md`,
  `docs/23-onboarding-permissoes-estados-vazios.md`, `docs/04-arquitetura.md`.
  Carregue `docs/ai/architecture-boundaries.md` somente se cruzar shell/domain.
- **Tests:** permission/onboarding tests e consumers de navegação/autenticação.
- **Skills:** `wayper-mobile-shell`.
- **Specialists:** lifecycle somente para AppState, permission ou native entry;
  persistence apenas se sessão durável for afetada.
- **Tools:** busca direta; Graphify só para bootstrap/consumer graph incerto.
- **Validation:** cold start, auth loading, signed-out/signed-in, deep links e
  permission denial proporcionais ao diff.
- **Risk flags:** `LIFECYCLE`, `FIREBASE`, `AUTH_SECURITY`, `UI_UX`,
  `NATIVE_ANDROID`.
- **Escalation:** mudança de auth boundary, ordem de registro nativo ou owner de
  sessão sobe para architectural/deep investigation.

### `PERSISTENCE_SYNC`

- **Triggers:** save mínimo, finalização, recovery storage, migração, fila
  deferida/sync, retry/replay, idempotência e consistência local/remota.
- **Negative triggers:** GPS ao vivo, geometria pura ou UI que apenas lê dados
  sem mudar durabilidade/contrato.
- **Entry points:** `src/services/run/runFinalizationService.js`,
  `runDeferredTaskQueueService.js`, `runSyncQueueService.js`,
  `src/services/runOfflineStorageService.js`, `src/services/storage/` e
  repositories de run/queue.
- **Primary owners:** finalization, deferred/sync services e repositories
  persistentes; Firestore nunca é requisito do caminho crítico.
- **Docs:** `docs/04-arquitetura.md`, `docs/05-modelo-de-dados.md`, ADR-012/026/028
  em `docs/08-decisoes-tecnicas.md`.
  Carregue `docs/ai/architecture-boundaries.md` se mudar owner/storage/sync.
- **Tests:** testes de run, offline storage, storage migration e repositories de
  run/sync.
- **Skills:** `wayper-persistence-sync`.
- **Specialists:** persistence; concurrency quando ordering/single-flight;
  lifecycle apenas no handoff/recovery correspondente.
- **Tools:** busca direta; Graphify para consumers/migration ampla.
- **Validation:** save antes de derivados, IDs estáveis, replay idempotente,
  recovery offline e falhas remotas não bloqueantes.
- **Risk flags:** `RUN_DATA_LOSS`, `OFFLINE_STORAGE`, `SYNC`, `FIREBASE`,
  `CONCURRENCY`, `DATA_MIGRATION`.
- **Escalation:** schema persistido, novo writer, alteração de fila/owner ou
  risco de perder corrida sobe nível e pode ativar `CRITICAL_RUNTIME`.

### `TERRITORY_GEO`

- **Triggers:** território, GPS/rota como dado geoespacial, coordenadas, filtros,
  distância, Turf, polígonos, captura, MapLibre data adaptation ou rendering de
  território.
- **Negative triggers:** cor/copy/layout do mapa sem mudança de dado geográfico;
  lifecycle GPS vivo sem transformação geoespacial.
- **Entry points:** `src/services/territory/`,
  `src/repositories/territoryRepository.js`, `src/services/tracking/`,
  `src/services/runTracking/pointFilters.js` e
  `src/components/Map/WayperMapLibre.js`.
- **Primary owners:** services de territory/tracking e repository; o componente
  adapta/renderiza, não redefine contratos de geometria.
- **Docs:** `docs/15-corrida-por-zonas.md`,
  `docs/wayper/03-mecanica-territorios.md`,
  `docs/wayper/05-gps-e-validacao.md`, `docs/05-modelo-de-dados.md`.
  Carregue `docs/ai/architecture-boundaries.md` se UI/geo/storage cruzarem.
- **Tests:** testes de territory, tracking path e territory repository.
- **Skills:** `wayper-territory-map` para território; `wayper-active-run` também
  quando GPS ao vivo/lifecycle for afetado.
- **Specialists:** geospatial; concurrency/lifecycle somente por flags reais.
- **Tools:** source e fixtures; Graphify para pipeline amplo; não usar graph
  gerado como evidência geométrica.
- **Validation:** ordem de coordenadas, normalização, validade, filtros,
  distância, local capture e rendering boundary.
- **Risk flags:** `GPS_GEO`, `RUN_DATA_LOSS`, `DATA_MIGRATION`, `PERFORMANCE`,
  `OFFLINE_STORAGE`, `UI_UX`.
- **Escalation:** mudança de schema/normalização, cálculo compartilhado ou GPS
  ativo cruza para persistence/run runtime e sobe de nível.

### `FIREBASE_AUTH`

- **Triggers:** Firebase config/SDK, Auth, Firestore access, regras de acesso,
  identidade, autorização e contrato remoto.
- **Negative triggers:** menção documental sem mudança de config/segurança;
  fallback local sem interação Firebase.
- **Entry points:** `src/firebaseConfig.js`, `googleAuth.js`,
  `src/services/auth/authService.js`, telas em `src/screens/Auth/` e repositories
  que importam Firestore.
- **Primary owners:** auth service e cada repository remoto; não há arquivo de
  regras Firestore versionado confirmado nesta baseline.
- **Docs:** `docs/wayper/08-firebase-firestore.md`, `docs/05-modelo-de-dados.md`,
  ADR-002/003 em `docs/08-decisoes-tecnicas.md`.
- **Tests:** testes dos repositories/services afetados; fluxo auth manual quando
  não houver suíte direta.
- **Skills:** `wayper-mobile-shell` para auth/bootstrap;
  `wayper-persistence-sync` para durabilidade/sync.
- **Specialists:** persistence somente para consistência/Firestore; lifecycle
  somente para boundary de sessão móvel.
- **Tools:** busca de imports/config; documentação oficial do SDK somente quando
  a API atual exigir confirmação.
- **Validation:** autorização mínima, ausência de segredo no Git, fallback local
  e erro remoto explícito.
- **Risk flags:** `FIREBASE`, `AUTH_SECURITY`, `SYNC`, `OFFLINE_STORAGE`,
  `DATA_MIGRATION`.
- **Escalation:** regra pública, schema remoto, trust boundary ou ausência de
  owner versionado torna a tarefa architectural.

### `SOCIAL`

- **Triggers:** feed, friends, groups, profile social, ranking e presença.
- **Negative triggers:** pós-corrida sem publicação/social; active run sem
  integração social.
- **Entry points:** telas sociais, `src/services/feed/`, `friends/`, `profile/`,
  `ranking/` e repositories `socialHome`, `ranking`, `userProfile`.
- **Primary owners:** services/repositories sociais e suas telas consumidoras.
- **Docs:** `docs/06-fluxos-de-usuario.md`,
  `docs/wayper/06-xp-nivel-ranking.md`, `docs/10-regras-de-negocio.md`.
- **Tests:** testes de feed, ranking, profile, social/home repositories.
- **Skills:** nenhuma por padrão; persistence somente se contrato durable/sync.
- **Specialists:** persistence apenas por storage/sync; demais papéis são
  nativos.
- **Tools:** busca direta; Graphify para feature ampla com muitos consumers.
- **Validation:** regra de visibilidade/ranking, fallback local, estados de erro
  e testes do owner.
- **Risk flags:** `PRODUCT_RULE`, `FIREBASE`, `SYNC`, `OFFLINE_STORAGE`, `UI_UX`,
  `AUTH_SECURITY`.
- **Escalation:** novo ranking/contrato social, autorização ou schema remoto pode
  cruzar product/persistence e tornar-se architectural.

### `UI_DESIGN`

- **Triggers:** sistema visual, layout, tipografia, color, componente, interação,
  motion, accessibility, native UI, styling do mapa, gamificação e pós-corrida.
- **Negative triggers:** copy-only/local sem decisão visual; mudança de
  source/owner de estado apenas porque aparece numa tela; runtime bug; refactor
  genérico; MapLibre data/geometry sem decisão visual.
- **Entry points:** `src/screens/`, `src/components/` e `src/theme/`.
- **Primary owners:** `DESIGN.md` para contrato; `src/theme/wayperTheme.js` para
  valores runtime; componente/tela existente para implementação.
- **Docs:** `DESIGN.md`, recorte de produto da tela e
  `docs/09-design-e-wireframes.md` somente como inventário histórico.
- **Tests:** teste adjacente quando existir e validação visual/acessibilidade
  direcionada.
- **Capabilities:** `design-system`, `layout`, `typography`, `color`, `motion`,
  `accessibility`, `native-ui`, `map-ui`, `gamification-ui`,
  `post-run-design` e `design-audit`; selecione o menor conjunto.
- **Modes:** `OPERATE` por default; `EXPERIENCE` somente para janela de resultado
  ou recompensa significativa. Copy-only e task não visual não carregam o
  contrato.
- **Skills:** nenhuma de design nesta baseline; todas as capabilities usam a
  reference on-demand. `wayper-mobile-shell` só para shell/navigation real.
- **Specialists:** nenhum por padrão; geospatial não revisa styling do mapa.
- **Tools:** source direto; Graphify não é necessário para ajuste local.
- **Validation:** `npm run quality:design`, estados, interação, accessibility,
  screenshot nativo e teste afetado conforme o diff.
- **Risk flags:** `UI_UX`, `PRODUCT_RULE`, `PERFORMANCE`.
- **Escalation:** state ownership, navegação pública ou vários fluxos reais sobe
  para bounded/architectural e adiciona domínio correspondente.

### `DIAGNOSTICS_SENTRY`

- **Triggers:** diagnóstico local, logging, export/upload de diagnóstico, Sentry,
  sanitização, crash e performance monitoring.
- **Negative triggers:** log citado em doc sem alteração de observabilidade;
  bug de produto que apenas será diagnosticado por source/testes.
- **Entry points:** `src/screens/DiagnosticsScreen.js`,
  `src/config/diagnosticsConfig.js`, `src/services/diagnostics/` e
  `src/services/monitoring/`.
- **Primary owners:** diagnostics services, monitoring bridge/Sentry e sanitizer.
- **Docs:** `docs/diagnostics.md`, `docs/11-plano-de-deploy.md`, ADR-016/025 em
  `docs/08-decisoes-tecnicas.md`.
- **Tests:** diagnostics e Sentry monitoring tests.
- **Skills:** nenhuma; active-run somente para diagnóstico no caminho crítico.
- **Specialists:** specialist do risco observado, não um reviewer de logging.
- **Tools:** busca/log local; painel externo só com acesso/autorização.
- **Validation:** redaction, fail-open, limite de output e testes do bridge.
- **Risk flags:** `PERFORMANCE`, `AUTH_SECURITY`, `BUILD_TOOLING`, `RUN_DATA_LOSS`.
- **Escalation:** dado sensível, trabalho pesado no GPS ou mudança de build
  adiciona security/run/build e eleva o nível.

### `ANDROID_NATIVE`

- **Triggers:** manifest, Kotlin/Java, foreground service, receiver,
  notification channel/action, permission Android, Gradle ou headless boundary.
- **Negative triggers:** componente React visual sem contrato nativo.
- **Entry points:** `android/app/src/main/AndroidManifest.xml`,
  `android/app/src/main/java/com/wayper/app/`, `app.json` e scripts Android.
- **Primary owners:** `MainActivity`, `MainApplication` e classes em
  `com/wayper/app/run`; JS continua owner do estado canônico da corrida.
- **Docs:** `docs/22-teste-real-corrida-background.md`,
  `docs/wayper/09-arquitetura-tecnica.md`, `docs/11-plano-de-deploy.md`.
- **Tests:** lifecycle contract/testes JS relacionados e checklist físico;
  teste automatizado não prova lifecycle real.
- **Skills:** `wayper-active-run` para service/notificação de corrida;
  `wayper-mobile-shell` para entry/permission.
- **Specialists:** lifecycle; concurrency para ordering/callback; persistence ou
  geospatial só pela responsabilidade afetada.
- **Tools:** source/manifest/Gradle; build/device quando necessário.
- **Validation:** registration, process recreation, notification actions,
  background/screen-off e fail-safe.
- **Risk flags:** `NATIVE_ANDROID`, `LIFECYCLE`, `CONCURRENCY`, `RUN_DATA_LOSS`,
  `BUILD_TOOLING`.
- **Escalation:** service/task/notification de corrida ativa recebe
  `CRITICAL_RUNTIME`; mudança de bridge/ownership é architectural.

### `TEST_BUILD`

- **Triggers:** Jest, warning de teste, dependency, package script, Expo/EAS,
  Metro, Android build, CI ou tooling.
- **Negative triggers:** palavra “teste” como pedido de verificação sem mudança
  no Harness/build; não existe custom agent tester.
- **Entry points:** `package.json`, `package-lock.json`, `metro.config.js`,
  `eas.json`, `app.json`, `scripts/` e `android/`.
- **Primary owners:** scripts/config atuais e a suíte relacionada.
- **Docs:** `docs/12-guia-de-testes.md`, `docs/11-plano-de-deploy.md`,
  `docs/13-bugs-conhecidos.md`, `docs/ai/static-analysis.md` para lint,
  `docs/ai/code-budgets.md` para tamanho e `docs/ai/architecture-boundaries.md`
  para gate arquitetural; `docs/ai/quality-gates.md` seleciona FAST/DEEP.
  `docs/ai/hooks-and-gates.md` só entra quando hook/backstop é o objeto da tarefa.
- **Tests:** suíte direcionada e `npm test -- --runInBand` quando o gate pedir.
- **Skills:** nenhuma por padrão; skill de domínio apenas se o teste cobre esse
  domínio.
- **Specialists:** nenhum por padrão; papéis de tester/debugger são nativos.
- **Tools:** comandos canônicos do `package.json`; `npm run quality:gate` agrega
  o FAST gate, enquanto lint/size/architecture continuam executáveis
  separadamente. `npm run quality:backstop` reproduz o completion backstop;
  não existe typecheck canônico.
- **Validation:** exit code, contagem, baseline, config syntax e diff check.
- **Risk flags:** `BUILD_TOOLING`, `PERFORMANCE`, `NATIVE_ANDROID`.
- **Escalation:** dependency/config pública, pipeline ou vários ambientes pode
  tornar a tarefa architectural.

### `PRODUCT_RULES`

- **Triggers:** regra de negócio, prioridade, entitlement, ranking/economia,
  feature approval ou conflito de direção.
- **Negative triggers:** implementação técnica inequívoca sem decisão de produto;
  roadmap/backlog isolado não autoriza código.
- **Entry points:** `docs/10-regras-de-negocio.md`, `docs/product/` e owners do
  domínio somente após autorização.
- **Primary owners:** direção estratégica, decisões aprovadas e regra temática;
  código/testes descrevem estado, não aprovam direção nova.
- **Docs:** `docs/product/direcao-estrategica-completa.md`, recorte temático,
  `docs/product/10-decisoes-aprovadas.md` e `docs/10-regras-de-negocio.md`.
- **Tests:** testes do domínio que codifica a regra.
- **Skills:** skill do domínio técnico somente após a decisão de produto.
- **Specialists:** specialist técnico pela flag; conflito aprovado exige humano.
- **Tools:** leitura documental e source; Graphify só para impacto transversal.
- **Validation:** regra aprovada, estados/bordas e teste de regressão.
- **Risk flags:** `PRODUCT_RULE`, `DATA_MIGRATION`, `UI_UX`, `AUTH_SECURITY`.
- **Escalation:** decisão nova, conflito normativo, entitlement ou economia
  cruza arquitetura/produto e não pode ser inferido.

### `HARNESS_AI`

- **Triggers:** `AGENTS.md`, docs de IA, skill, custom agent, Codex config,
  Graphify/RTK routing ou política do Harness.
- **Negative triggers:** mudança de runtime/produção que apenas usa o Harness;
  mencionar AGENTS não carrega docs de corrida.
- **Entry points:** `AGENTS.md`, `docs/ai/`, `docs/14-instrucoes-para-ia.md`,
  `.agents/skills/` e `.codex/agents/`.
- **Primary owners:** `AGENTS.md` para permanentes, `harness-v1.md` para
  arquitetura, classifier/router/process-workflows para decisão e cada
  skill/agent para workflow especializado; `quality-gates.md` para gates/review;
  `meta-goal-runtime.md` para metas contínuas/autonomia e `memory-policy.md` para
  hard-earned learning on-demand; `hooks-and-gates.md` somente para runtime de
  hooks/automação determinística; `capability-architecture.md` e seu registry
  para capabilities/closure; `token-economy.md` para leitura, output, briefs e
  compaction; `external-skill-acquisition.md` somente após `CAPABILITY_GAP` ou
  quando aquisição externa for o objeto explícito da tarefa.
- **Docs:** `harness-v1.md` e somente o owner do aspecto tocado; não pré-carregue a
  suíte `docs/ai`. `token-economy.md` entra para contexto/output/RTK/Caveman,
  compaction ou brief, não em toda mudança de Harness.
- **Tests:** evals declarativas de routing, links, metadata/config e suíte do
  produto para garantir ausência de regressão; `npm run quality:meta-goal`
  quando Goal Execution Contract, completion ou falsification mudar;
  `npm run quality:capabilities` quando registry/closure/aquisição mudar.
- **Skills:** nenhuma skill de domínio por padrão.
- **Specialists:** nenhum dos quatro reviewers mobile por padrão; papéis de
  architecture/review genérico são nativos.
- **Tools:** busca direta; Graphify apenas para inventário/dependência ampla;
  Codex doctor para saúde/config suportada.
- **Validation:** links/paths, nomes existentes, config TOML, custo permanente,
  bytes BEFORE/AFTER quando token economy mudar e working tree.
- **Risk flags:** `DOCUMENTATION`, `BUILD_TOOLING`.
- **Escalation:** config/hook global, novo mecanismo ou mudança de ownership exige
  evidência de suporte e boundary project/global.

## Skill routing

| Skill | Trigger | Do not trigger | Domains | Risk flags comuns | Validation | Specialists possíveis |
| --- | --- | --- | --- | --- | --- | --- |
| `wayper-active-run` | estado/GPS/lifecycle da corrida ativa, recovery ou finish handoff | copy/style de corrida, UI pós-corrida, derivado sem lifecycle | `RUN_RUNTIME`, `ANDROID_NATIVE`, `TERRITORY_GEO` quando GPS vivo | `RUN_DATA_LOSS`, `LIFECYCLE`, `CONCURRENCY`, `GPS_GEO`, `NATIVE_ANDROID` | lifecycle contract, owners/testes, save mínimo, matriz física aplicável | lifecycle, concurrency, geospatial, persistence pelas flags |
| `wayper-mobile-shell` | entry, providers, auth gate, root navigation, deep link, onboarding, permission | runtime ativo, finalization/queues, detalhe local de tela | `MOBILE_SHELL`, `FIREBASE_AUTH`, `UI_DESIGN` no shell | `LIFECYCLE`, `AUTH_SECURITY`, `FIREBASE`, `UI_UX` | cold start, auth/nav/deep-link/permission paths | lifecycle; persistence só se sessão durável |
| `wayper-persistence-sync` | save/finalization/recovery storage, migration, deferred/sync/replay | GPS vivo, geometria pura, UI-only | `PERSISTENCE_SYNC`, `FIREBASE_AUTH`, `SOCIAL` quando durable | `RUN_DATA_LOSS`, `OFFLINE_STORAGE`, `SYNC`, `FIREBASE`, `CONCURRENCY`, `DATA_MIGRATION` | durable ordering, offline recovery, idempotência, falha remota | persistence, concurrency, lifecycle no handoff |
| `wayper-territory-map` | territory geometry/capture/storage, coordinates, MapLibre data/rendering | styling visual sem geo, live lifecycle, post-run queue | `TERRITORY_GEO`, `UI_DESIGN` só no boundary de dados | `GPS_GEO`, `OFFLINE_STORAGE`, `DATA_MIGRATION`, `PERFORMANCE` | coordenadas, normalização, validade, capture e repository | geospatial; outros só por flags adicionais |

## Specialist routing

Custom agent nunca é default. Delegue só quando especialização ou isolamento de
contexto superar o overhead. Specialists read-only independentes podem compor a
mesma wave `S2`; não conversam entre si e o agente principal sintetiza.

| Specialist | Trigger | Negative trigger |
| --- | --- | --- |
| `wayper_concurrency_reviewer` | race, async ownership, single-flight, stale callback, lock, cancellation ou write ordering | fluxo sequencial sem estado compartilhado ou risco apenas hipotético |
| `wayper_mobile_lifecycle_reviewer` | AppState, mount/unmount relevante, foreground/background, screen off, notification, Android lifecycle ou headless task | styling/UI sem transição de lifecycle/native boundary |
| `wayper_persistence_reviewer` | local/recovery storage, migration, sync queue, Firestore consistency, durability ou idempotência | leitura/UI sem mudança de storage/ordering |
| `wayper_geospatial_reviewer` | GPS, route geometry, Turf, MapLibre data, territory, coordinates, filters ou distance | copy/style/layout do mapa sem transformação geográfica |

Descoberta, pesquisa, teste, debugging, arquitetura, implementação e review
genérico usam o agente principal ou subagentes nativos do Codex. Não recriar
`mapper`, `researcher`, `tester`, `debugger`, `architect`, `implementer` ou
reviewer genérico. Workers nativos só escrevem em paralelo segundo
[`docs/ai/orchestration.md`](orchestration.md).

## Graphify, RTK e modos de output

Use Graphify quando ownership é incerto, o dependency map é amplo, consumers
cruzam módulos, a tarefa é architectural, o refactor é grande ou o import graph
reduz incerteza. Não use quando o alvo é conhecido, a mudança é trivial/doc/local
ou busca direta resolve mais barato. Graphify descobre; source confirma.

RTK permanece `USER_GLOBAL` e opcional. Prefira output comprimido quando ele
preservar evidência; use raw quando debugging exigir e nunca esconda erro
material. O projeto funciona sem RTK e não possui adapter próprio.

[`token-economy.md`](token-economy.md) seleciona `COMPACT`, `CLEAR` e `EXACT`.
Comece arquivos grandes por outline/symbol/caller e ranges suficientes; leia o
arquivo inteiro somente quando a semântica atravessar o arquivo. Caveman e
compaction nativa continuam globais/runtime, nunca fonte de verdade.

## Seleção negativa de documentos

- **UI simples:** `AGENTS.md`, target e doc visual/fluxo somente se necessário;
  não carregar runtime, territory, monetização ou estratégia completa.
- **Recovery de corrida:** active-run, sources/tests de runtime e docs de
  arquitetura/recovery; não carregar site/marketing/territory sem integração.
- **Pós-corrida visual:** UI/fluxo e owner da tela; não carregar tracking ativo
  só porque a tela mostra uma corrida.
- **Memory:** tarefa trivial ou bounded não relacionada carrega zero; bug
  screen-off pode consultar lifecycle/run, Firestore social não consulta run
  memory automaticamente.
- **Decisão de produto:** fontes aprovadas do recorte e owner técnico afetado;
  roadmap/backlog isolado não basta.

Os casos executáveis de aceitação estão em
[`docs/ai/routing-evals.md`](routing-evals.md).

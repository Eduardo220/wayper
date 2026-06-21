# Decisões Técnicas

Este arquivo registra decisões relevantes do projeto. Decisão não registrada vira arqueologia depois, e ninguém merece escavar commit velho.

## ADR-001: Usar React Native com Expo

**Status:** aceito  
**Contexto:** o Wayper é um app mobile com necessidade de GPS, mapa, câmera/arquivos em algumas features e build Android.  
**Decisão:** usar React Native com Expo e Expo Dev Client.  
**Consequências:**

- Desenvolvimento mobile mais rápido.
- Boa integração com módulos de localização.
- Build Android controlado por scripts.
- Algumas bibliotecas nativas exigem cuidado com prebuild/dev client.

## ADR-002: Usar Firebase como backend inicial

**Status:** aceito  
**Contexto:** o app precisa de autenticação, persistência e sincronização.  
**Decisão:** usar Firebase Auth e Firestore.  
**Consequências:**

- Menos backend próprio no início.
- Regras de segurança do Firestore viram parte crítica do projeto.
- Algumas regras de negócio sensíveis talvez precisem migrar para Cloud Functions no futuro.

## ADR-003: Usar MapLibre/OpenFreeMap para mapas

**Status:** aceito  
**Contexto:** o app depende muito de mapa e visualização de zonas.  
**Decisão:** usar MapLibre React Native com OpenFreeMap.  
**Consequências:**

- Mais controle sobre visualização do mapa.
- Menor dependência de provedores pagos tradicionais.
- Exige atenção a performance e renderização de polígonos/rotas.

## ADR-004: Usar Turf para cálculos geográficos

**Status:** aceito  
**Contexto:** o app precisa calcular distância, área e manipular geometrias.  
**Decisão:** usar Turf quando fizer sentido para cálculos geoespaciais.  
**Consequências:**

- Facilita cálculo de área e operações com GeoJSON.
- Precisa validar performance em rotas grandes.
- Cálculos críticos devem ter testes.

## ADR-005: Separar `develop` e `main`

**Status:** aceito  
**Contexto:** o projeto precisa diferenciar desenvolvimento ativo e versão oficial.  
**Decisão:** `develop` será branch de desenvolvimento, `main` será branch oficial.  
**Consequências:**

- Mudanças passam primeiro por `develop`.
- `main` deve receber apenas versões estáveis.
- Pull requests para `main` devem ser mais criteriosos.

## ADR-016: Usar Sentry como complemento ao diagnostico local

**Status:** aceito
**Contexto:** o Wayper precisa observar crashes, excecoes e performance em builds reais sem enviar rotas, coordenadas ou artefatos detalhados da corrida para um servico externo. O diagnostico local em NDJSON/ZIP ja e a fonte detalhada para investigar GPS, background, storage e notificacao.
**Decisao:** usar `@sentry/react-native` com Expo Dev Client para erros, breadcrumbs e tracing basico. O Sentry complementa, mas nao substitui, reduz ou altera a persistencia local de diagnosticos.
**Politica:**

- `development`: envio desligado por padrao; exige `EXPO_PUBLIC_SENTRY_ENABLE_DEV=true`.
- `staging`: envio ativo quando existe DSN.
- `production`: envio ativo quando existe DSN.
- Sampling de tracing: `0.20` em development, `0.15` em staging e `0.08` em production.
- Session Replay, logs remotos em massa e `sendDefaultPii` ficam desativados.
- `error` e `fatal` sao enviados; warnings importantes usam filtro e throttle; `info/debug` nao viram eventos.
- Coordenadas, paths, rotas, snapshots, NDJSON, imagens, ZIPs, tokens, headers de auth, email e telefone sao removidos antes do envio.
- IDs de corrida/usuario presentes em contexto remoto sao pseudonimizados.

**Consequencias:**

- Crashes e falhas criticas ficam visiveis por release, ambiente e build.
- Breadcrumbs de corrida/lifecycle ajudam a reconstruir a sequencia sem expor o trajeto.
- Source maps exigem `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` e `SENTRY_PROJECT` no ambiente de build.
- Investigacao profunda de GPS continua usando o ZIP/NDJSON local, inclusive quando coordenadas exatas forem habilitadas explicitamente para um teste.

## ADR-006: Persistir corrida ativa localmente antes do Firestore

**Status:** aceito
**Contexto:** a Wayper precisa garantir que uma corrida nao seja perdida por perda de internet, fechamento do app ou falha durante a atividade. O projeto ja usa AsyncStorage em servicos de perfil, sync, zonas e territorio, e a rota salva ja possui limites de pontos para historico e renderizacao.
**Decisao:** a corrida ativa deve ter uma camada local propria (`runOfflineStorageService`) como fonte de verdade durante a atividade. Corridas ativas devem ser persistidas localmente por checkpoint continuo e sincronizadas de forma idempotente com Firestore. A sincronizacao com Firestore acontece somente apos a corrida ser finalizada e salva localmente, com status de sync pendente ate o envio remoto concluir.
**Consequencias:**

- GPS, pausa, retomada, tempo, distancia e desenho da rota deixam de depender de Firestore durante a corrida.
- Corridas finalizadas offline aparecem no historico local como pendentes de sincronizacao.
- O app pode restaurar uma corrida ativa ou finalizada nao salva ao reabrir.
- AsyncStorage continua aceitavel nesta etapa por ser padrao atual do projeto e por usar limites de pontos; se atividades longas excederem esse volume, migrar a camada para SQLite/Expo SQLite.
- O Firestore recebe dados depois, por fila e sincronizacao automatica quando a conexao voltar.

## ADR-007: Consolidar fonte de verdade da corrida ativa

**Status:** aceito
**Contexto:** a corrida ativa passou a ter dois snapshots locais: `wayper:activeRun:v2` e `wayper_active_offline_run_v1`. A duplicidade podia recuperar estado antigo, duplicar fila de sync ou fazer uma corrida finalizada voltar como ativa.
**Decisao:** `activeRunTrackingService` / `activeRunState` sao a fonte de verdade canonica da corrida ativa. `runOfflineStorageService` permanece como checkpoint legado, compatibilidade e rascunho final temporario. `runRecoveryService` centraliza conflito, migracao e limpeza.
**Consequencias:**

- `MapScreen` nao decide mais entre storages concorrentes.
- Legado vivo e migrado para o snapshot canonico antes de chegar na UI.
- Corridas finalizadas ou pendentes de sync nao voltam como ativas.
- Checkpoints legados mais antigos nao sobrescrevem checkpoints mais recentes do mesmo `localRunId`.
- Firestore continua sendo apenas destino de sincronizacao posterior.

## ADR-008: Blindar auto-save, recovery e finalizacao offline

**Status:** aceito
**Contexto:** mesmo com a fonte canonica consolidada, ainda era necessario proteger bordas operacionais: app indo para background/inactive, tela bloqueada, erro temporario de GPS, reload durante corrida e queda durante finalizacao.
**Decisao:** manter `activeRunTrackingService`/`activeRunState` como fonte primaria e reforcar `runAutoSaveService` como checkpoint consolidado. O autosave passa a escrever periodicamente, em AppState critico, em erro recuperavel de localizacao e antes do finish. `FINISHING` e considerado estado finalizado para recovery.
**Consequencias:**

- Corrida running ou paused tem snapshots mais recentes mesmo sem novo ponto aceito.
- Falhas de GPS disparam checkpoint com throttle, sem criar trajeto falso.
- Checkpoints antigos continuam bloqueados por `checkpointAtMs`.
- Se o app cair durante finish, recovery nao ressuscita a corrida como ativa.
- Firestore segue opcional para preservar e finalizar corrida localmente.

## ADR-009: Notificacao persistente Android para corrida ativa

**Status:** aceito
**Contexto:** a corrida ativa ja tinha fonte canonica, autosave e recovery, mas ainda precisava de um ponto operacional confiavel para tela bloqueada/background e acoes basicas fora da UI.
**Decisao:** usar o modulo nativo Android existente `WayperRunNotificationAndroid` e o foreground service `RunNotificationForegroundService`, coordenados por `runNotificationService`. A notificacao e alimentada somente pelo snapshot canonico `wayper:activeRun:v2`; pausar/retomar pela notificacao chama `activeRunTrackingService` e dispara checkpoint via `runAutoSaveService`. Nao usar `expo-notifications` nesta etapa porque o projeto ja possui modulo nativo proprio para foreground service de corrida.
**Consequencias:**

- A notificacao persistente mostra status, tempo e distancia da corrida ativa.
- O botao da notificacao alterna entre `Pausar` e `Retomar` sem criar corrida nova.
- Tocar na notificacao abre `wayper://run/active` e reentra na tela de corrida ativa.
- Finalizar pela notificacao fica fora do escopo porque exige confirmacao/resumo; finalizar permanece no app.
- Firestore nao participa do controle da notificacao nem da preservacao da corrida ativa.
- O comportamento real ainda precisa ser validado em aparelho Android fisico, Dev Client e release, especialmente com economia agressiva de bateria.

## ADR-010: Pipeline canonico de GPS, path e renderizacao

**Status:** aceito
**Contexto:** a corrida ativa ja tinha snapshot local-first, autosave, recovery e notificacao, mas ainda precisava reduzir riscos de trajeto visual errado, distancia inflada por jitter, salto impossivel, ponto antigo fora de ordem e divergencia entre corrida livre e corrida por zonas.
**Decisao:** manter `src/services/tracking` como pipeline canonico para normalizacao, validacao, classificacao, segmentacao, distancia e render path. `activeRunTrackingService` continua alimentando essa sessao; lotes de background sao ordenados por timestamp antes de entrar no pipeline. `trustedPath` e a fonte de metricas; `renderPath` e somente visual; `rawPath` fica para diagnostico; `segments` preserva pausa explicita e gap tecnico relevante.
**Consequencias:**

- Pontos sem timestamp valido, timestamp futuro absurdo, ponto antigo anterior ao inicio, coordenada invalida, `0,0`, duplicata e ponto fora de ordem nao entram como deslocamento valido.
- Accuracy, velocidade, aceleracao, jitter e gaps usam thresholds centralizados em `trackingConfig.js`.
- Gap curto com deslocamento plausivel nao fragmenta a rota; gap longo ou salto grande quebra segmento para nao desenhar ponte falsa nem somar distancia impossivel.
- Suavizacao/simplificacao ficam restritas ao `renderPath` e nao alteram distancia, XP, territorio ou sync.
- Corrida livre, corrida por zonas, background, recovery, historico, replay e compartilhamento devem reaproveitar `trustedPath/renderPath/segments` em vez de criar logica paralela.
- Testes automatizados cobrem timestamp, gaps, background ordenado, ponto pausado e GeoJSON `MultiLineString`; validacao final de qualidade visual ainda exige aparelho fisico em rua.

## ADR-011: Historico e detalhes de corrida local-first

**Status:** aceito
**Contexto:** corridas finalizadas ja eram salvas localmente e sincronizadas depois, mas historico/detalhe ainda precisavam de uma regra explicita para abrir corridas offline, pendentes, com sync falho ou ja sincronizadas sem depender do Firestore.
**Decisao:** a fonte local oficial do historico de corridas finalizadas e a chave `runs` do AsyncStorage, acessada por `sync.loadLocalRunHistory()` / `sync.findLocalRunById()`. `saveLocalRun()` normaliza e deduplica registros por `id`, `localRunId`, `remoteRunId`, `runId` e `legacyId`. A tela de detalhes prefere a copia local quando ela existe e usa o objeto da navegacao apenas como fallback.
**Consequencias:**

- Corrida salva localmente aparece no historico mesmo offline, pendente, com sync falho ou sincronizada.
- Firestore continua destino de sincronizacao posterior, nao dependencia para listar ou abrir detalhe.
- Corrida ativa, pausada, recovering ou `FINISHING` nao entra como corrida finalizada se cair por acidente na chave `runs`.
- Quando local e remoto representam a mesma corrida, aparece uma unica vez, preservando `remoteRunId`, `localRunId`, `syncStatus`, `offlineStatus`, `trustedPath`, `renderPath`, `rawPath` e `segments`.
- Detalhes abrem por `localRunId`, `remoteRunId`, `id` atual ou id legado.
- Metricas exibidas priorizam distancia/duracao salvas; rota visual usa `renderPath`/`segments` quando disponiveis.
- AsyncStorage segue aceitavel nesta etapa; se historico com rotas longas ficar pesado, migrar a interface local para SQLite sem mudar telas.

## ADR-012: Fila local idempotente para sync de corridas finalizadas

**Status:** aceito
**Contexto:** depois da consolidacao local-first, corridas finalizadas podiam ficar pendentes, falhar no Firestore ou ser reprocessadas depois de reabrir o app. A fila precisava evitar duplicacao remota, preservar a copia local completa e continuar mostrando corridas com falha.
**Decisao:** a fonte oficial da fila e o mesmo historico local `runs`, lido por `sync.loadLocalRunHistory()` e atualizado por `sync.saveLocalRun()`. `runSyncQueueService` permanece como wrapper de enfileiramento e passa a usar a regra de selecao exposta por `sync.js`. O sync de runs processa uma corrida por vez, usa `remoteRunId` quando existir, usa `localRunId` como fallback idempotente, tenta localizar remoto por `localRunId` antes de criar documento e grava `localRunId`/`remoteRunId` no payload remoto.
**Consequencias:**

- `PENDING`, `PENDING_SYNC`, `FAILED`, `SYNC_FAILED`, `LOCAL_ONLY` e `SYNCING` sao normalizados para a fila sem esconder a corrida do historico.
- Corridas `SYNCED` sem alteracao pendente nao entram na fila.
- Corridas `RUNNING`, `PAUSED`, `RECOVERING` e `FINISHING` continuam fora do historico finalizado e da fila.
- Falha de uma corrida nao interrompe as demais; cada item fica `SYNCED` ou `SYNC_FAILED` localmente.
- Firestore indisponivel, permissao negada, auth ausente, payload invalido ou doc id remoto invalido viram erro controlado sem apagar a copia local.
- O lock em memoria impede dois syncs de runs simultaneos; NetInfo/AppState apenas agendam nova tentativa com debounce.
- Se a copia local muda durante o envio, o sync antigo preserva `remoteRunId`, mas deixa a corrida pendente para novo envio em vez de marcar como `SYNCED`.
- O payload remoto e sanitizado para remover `undefined`/funcoes e preservar metricas, modo, rota e campos territoriais existentes.
- Para proteger tamanho de documento, paths remotos continuam limitados por `ROUTE_CAP`; a copia local nao e cortada e o payload registra contadores/truncamento em `remoteRouteLimits`.
- Sync de runs e sync de territorios continuam separados; falha territorial nao apaga nem despublica a corrida local.

## ADR-013: Camada incremental de repositories local-first

**Status:** aceito
**Contexto:** a corrida ativa, historico e fila de sync ja estavam local-first, mas algumas telas ainda acessavam Firestore diretamente e outros dominios misturavam UI, cache local e rede. Uma refatoracao grande demais aumentaria risco nos fluxos recem estabilizados.
**Decisao:** introduzir repositories/facades finos por dominio, preservando as fontes oficiais existentes. `RunRepository` usa `sync.js` por baixo; `RunSyncQueueRepository` usa `runSyncQueueService`/`sync.js`; `TerritoryRepository` usa `territoryStorageService`; `UserProfileRepository` usa `profileService` com Firestore/Storage como melhor esforco; `RankingRepository` diferencia remoto, cache, local, demo e vazio. `LocalMetadataRepository` e `storageMigrationService` registram schemaVersion, migrations executadas e storages legados sem apagar dados. SQLite nao entra nesta etapa.
**Consequencias:**

- Telas adaptadas deixam de conhecer Firestore diretamente e passam a consumir repository/service.
- `runs` continua sendo a fonte local oficial de corridas finalizadas.
- `wayper:activeRun:v2` continua sendo a fonte canonica da corrida ativa.
- `runService.js` e `wayper_unsynced_runs_v2` seguem legados, nao reativados.
- `zones` e `@wayper_zones` ficam legados e so entram por leitura/migracao explicita.
- Perfil e ranking podem falhar remotamente sem quebrar a UI adaptada; mock/demo nao deve ser exibido como ranking real.
- Firestore segue presente em services de sync, perfil, ranking, feed, amigos, grupos, notificacoes e territorio remoto, mas deixa de ser dependencia direta nas telas alteradas.
- SQLite/Expo SQLite deve ser reavaliado apenas se medicao real mostrar parse/carregamento pesado de rotas longas no AsyncStorage.

## ADR-014: Territorios e zonas local-first incrementais

**Status:** aceito
**Contexto:** corrida ativa, historico, detalhes, GPS/path e sync de runs ja estavam local-first. Territorio ainda tinha risco de tela ou fallback escrever em `zones` legado, perder `territorySummary` da corrida por zonas ou mostrar feed sem dados locais quando Firestore falhasse.
**Decisao:** consolidar `TerritoryRepository` como facade local-first de territorio atual, mantendo `territoryStorageService`, `territoryCaptureService` e `sync.js` como services oficiais por baixo. O storage local atual de territorios e `wayper_territories_v1`; eventos usam `wayper_territory_events_v1`; leaderboards/cache usam `wayper_territory_leaderboards_v1`. `zones` e `@wayper_zones` continuam apenas como legado/migracao explicita. Corrida por zonas salva localmente area, geometria, coords, resumo, eventos e celulas capturadas quando a captura local sucede. Corrida livre e normalizada para nao preservar territorio falso. Firestore segue como melhor esforco e sync futuro; nao implementar sync territorial social completo nesta etapa. SQLite nao entra nesta etapa.
**Consequencias:**

- Mapa e dashboard passam a carregar territorios locais atuais via `TerritoryRepository`.
- Feed da home usa territorios locais atuais como fallback quando Firestore falha e nao cria atividade demo quando remoto/cache/local estao vazios.
- Fallback antigo de captura em `sync.createAndSaveZoneFromPath()` nao deve ser usado pelo fluxo novo de `MapScreen`.
- `territoryCaptureService` continua responsavel por validacao, geometria, anti-fraude basico, eventos, leaderboards locais e persistencia local.
- `syncTerritoriesToFirestore()` e `syncTerritoryEventsToFirestore()` continuam separados de runs. Falha remota territorial nao apaga territorio local nem quebra historico.
- `zones` remoto ainda pode existir como espelho/compatibilidade em services de sync, mas nao e a fonte local nova.
- AsyncStorage permanece suficiente para o volume atual. SQLite/Expo SQLite deve ser reavaliado com medicao real de quantidade de territorios, eventos e custo de parse/renderizacao no mapa.

## ADR-015: XP, progresso e conquistas local-first

**Status:** aceito
**Contexto:** o app ja tinha corrida ativa, historico, sync de runs e territorios locais consolidados. A base antiga de XP (`xpService`) atualizava perfil/Firestore e `MedalsWidget` mantinha medalhas visuais, mas isso nao garantia progresso offline, idempotencia por corrida nem separacao clara entre dado real e demo/legado.
**Decisao:** criar uma camada local-first especifica para gamificacao. `ProgressionRepository` passa a ser a fonte local de XP, nivel, progresso agregado e eventos de XP usando `wayper_user_progress_v1` e `wayper_xp_events_v1`. `AchievementRepository` passa a ser a fonte local de catalogo, progresso parcial e conquistas desbloqueadas usando `wayper_achievements_v1` e `wayper_achievement_progress_v1`. A integracao ocorre apenas depois que a corrida finalizada foi salva localmente. Firestore fica fora do caminho critico e o sync remoto de XP/conquistas fica preparado por metadata, mas nao implementado nesta etapa.
**Consequencias:**

- Corrida finalizada valida gera XP local mesmo offline.
- Corrida ativa, `FINISHING`, descartada, invalida ou suspeita nao gera XP.
- Eventos usam ID deterministico por `userId`, `sourceRunId/localRunId` e `type`, evitando duplicacao em reabertura, retry de sync ou sync remoto futuro.
- Corrida livre nao recebe XP territorial falso; corrida por zonas pode receber XP territorial apenas quando area/captura/celulas validas ja existem.
- Perfil e dashboard podem consumir progresso local sem depender de Firestore.
- `xpService`, `territoryXp`, `MedalsWidget`, storage `medals` e `@wayper:medals_awarded_v1` ficam como legado/visual ate uma migracao explicita; nao sao fonte de progresso real.
- Recalculo completo a partir de `runs` existe como operacao segura/idempotente, mas nao apaga progresso local nem eventos antigos por padrao.
- SQLite nao entra nesta etapa; se volume de eventos/progresso crescer, medir antes de migrar storage.

## ADR-016: Feedback imediato ao iniciar corrida

**Status:** aceito
**Contexto:** o fluxo de inicio da corrida executava permissoes, refresh de localizacao, provider de rede e warmup de GPS antes de exibir a contagem regressiva. Isso podia gerar varios segundos sem resposta visual apos o toque.
**Decisao:** o toque em iniciar corrida deve armar imediatamente `isStartingRun`, bloquear novos cliques e exibir o feedback/countdown. A duracao da contagem fica centralizada em `RUN_START_COUNTDOWN_SECONDS = 1`. Permissoes essenciais continuam validadas antes de criar a corrida, mas tarefas pesadas de GPS nao podem bloquear a exibicao do feedback inicial. A coleta foreground/background deve ser solicitada antes da busca pontual de `getCurrentPositionAsync`.
**Consequencias:**

- O usuario ve resposta visual praticamente no toque, mesmo quando permissao ou notificacao ainda precisam ser resolvidas.
- Duplo clique nao cria duas corridas, dois watchers ou duas notificacoes.
- GPS pode aquecer em paralelo ao inicio da corrida; qualidade ruim vira aviso/diagnostico, nao delay silencioso.
- Corrida livre e corrida por zonas compartilham o mesmo guard e countdown.

## ADR-017: Perfil e ranking local-first com origem explicita

**Status:** aceito
**Contexto:** perfil e ranking ja tinham fallback local/cacheado, mas as estatisticas do perfil ainda podiam depender de agregados legados do perfil remoto/local e o ranking local so cobria lideres territoriais. Isso deixava risco de Firestore indisponivel apagar contexto local, de mock/demo ser confundido com dado real e de corridas sincronizadas/localmente pendentes inflarem ou sumirem das estatisticas.
**Decisao:** consolidar estatisticas locais em `src/repositories/profileStats.js`, consumindo `RunRepository`, `TerritoryRepository`, `ProgressionRepository` e `AchievementRepository`. `UserProfileRepository` passa a mesclar essa visao no perfil local/cacheado. `RankingRepository` passa a retornar `remote`, `cache`, `local`, `empty` ou `demo` de forma explicita, calculando uma linha local real para distancia, XP, area/territorio e numero de corridas quando houver dado suficiente.
**Consequencias:**

- Perfil abre sem Firestore e mostra estatisticas reais de corridas finalizadas locais, XP/nivel/conquistas locais e territorios atuais locais.
- Corridas `RUNNING`, `PAUSED`, `RECOVERING` e `FINISHING` ficam fora das estatisticas finalizadas; corridas pendentes ou com falha de sync continuam contando como dado local real.
- Dedupe de estatisticas usa `localRunId`, `remoteRunId`, `id`, `runId` e `legacyId`.
- Corrida livre nao soma territorio falso; corrida por zonas usa area territorial real quando presente.
- Ranking cacheado carrega `updatedAt`/`cachedAt` e pode receber overlay apenas da linha local do proprio usuario, sem duplicar identidade.
- Ranking local nao inventa oponentes; se so houver o usuario local, a resposta e `source: "local"` e `limited: true`.
- Ranking vazio retorna `source: "empty"` quando nao ha dado real suficiente para o criterio/periodo.
- Ranking demo so aparece com `source: "demo"`, opt-in explicito e ambiente dev; erro remoto nunca cai para demo silencioso.
- Upload de avatar usa Storage como melhor esforco; falha de upload preserva avatar local/cacheado e nao grava `file://` como avatar remoto.
- AsyncStorage continua suficiente nesta etapa; se volume de runs/territorios tornar o calculo pesado, medir antes de migrar para SQLite ou agregados precomputados.

## ADR-018: Home principal como feed social local-first

**Status:** aceito
**Contexto:** uma implementacao anterior transformou `Inicio` em dashboard pessoal com perfil, XP, estatisticas, ultima corrida, territorio, ranking, sync e atalhos. Esses dados sao uteis, mas o papel de produto da Home e social, no estilo feed/stories de corridas e atividades. Dados pessoais devem ficar em `Perfil`, `Dashboard` ou resumo dedicado.
**Decisao:** refatorar `HomeScreen` para consumir `src/repositories/socialHomeRepository.js`. A Home passa a exibir stories de corrida, amigos recentes quando houver dado real/cacheado, feed social de atividades e a acao "Adicionar ao story" baseada em corridas finalizadas locais. `homeDashboardRepository.js` e `profileStats.js` ficam preservados para dashboard pessoal/perfil, mas deixam de ser o conteudo principal de `Inicio`.
**Consequencias:**

- `Inicio` volta a ser social e nao uma dashboard pessoal.
- `socialHomeRepository` encapsula `feedService`, `RunRepository`, `UserProfileRepository`, `activeRunTrackingService`, `wayper_run_stories_v1` e `wayper_activity_feed_cache_v1`.
- A tela nao chama Firestore diretamente; remoto e melhor esforco e falha remota cai para cache/local/vazio.
- `feedService` nao retorna amigos mockados por padrao; demo exige opt-in dev explicito e ainda e filtrado pela Home.
- Stories locais usam `syncStatus=PENDING_SYNC` e nao fingem publicacao remota.
- A selecao de story lista apenas corridas finalizadas do usuario e exclui ativa/`FINISHING`.
- Duplicar story da mesma corrida e bloqueado sem criar outro registro.
- `online` so aparece quando ha dado de presenca real/cacheado; sem isso a UI fala em amigos recentes.
- Corrida livre nao mostra territorio falso; corrida por zonas preserva area quando existir.
- A Home preserva o atalho para `Mapa`, mas nao reimplementa corrida ativa, GPS/path, sync de runs ou historico.
- `DashboardScreen` e `ProfileScreen` continuam responsaveis por estatisticas pessoais, XP, territorio, ranking e sync.

## ADR-019: Onboarding, permissoes e estados vazios local-first

**Status:** aceito
**Contexto:** usuario novo, offline ou com Firestore indisponivel precisava entender o Wayper sem ficar preso em prompts repetidos, spinners infinitos ou dados demo parecendo reais. O app tambem precisava separar permissao essencial de permissao limitante sem reimplementar a corrida ativa.
**Decisao:** consolidar `src/services/permissions.js` como facade unica de permissoes, adicionar onboarding local-first em `OnboardingScreen` e padronizar empty/error/offline/permission/loading/retry em `src/components/states`. Onboarding informa, mas nao pede permissoes nativas. Foreground location e requisito para iniciar/retomar corrida. Background location e notificacoes devem ser explicadas antes de pedir e, se negadas, viram limitacao comunicada sem bloquear o app inteiro.
**Consequencias:**

- O app nao pede permissao em loop no mount/focus.
- `shouldShowPermissionEducation` e `markPermissionEducationSeen` guardam educacao por permissao.
- `normalizePermissionStatus` padroniza `granted`, `denied`, `blocked`, `limited`, `unavailable`, `unknown` e `checking`.
- Usuario bloqueado por `canAskAgain=false` recebe acao de abrir configuracoes.
- Negar notificacao nao quebra corrida; negar background nao permite prometer tela bloqueada perfeita.
- Firestore falhando deve mostrar local/cache/vazio honesto; demo/mock nunca e fallback silencioso.
- Estados vazios de Home, Historico, Detalhe, Perfil, Ranking e Dashboard devem usar copy acionavel e componentes compartilhados quando possivel.

## ADR-020: Compartilhamento de corridas local-first

**Status:** aceito
**Contexto:** corridas finalizadas ja ficam em `runs`/`RunRepository`, a Home social ja usa stories locais em `wayper_run_stories_v1`, e o app precisa compartilhar/baixar imagem e PNG sem depender de Firestore. O pipeline de GPS separa `trustedPath` para metricas, `renderPath` para visual e `segments` para pausas/gaps.
**Decisao:** consolidar o fluxo visivel em `RunShareModal`, com opcoes `Imagem` e `Tracado PNG`. `Imagem` exporta card Wayper com mapa/rota e metricas salvas. `Tracado PNG` exporta PNG transparente apenas com rota ou poligono real de zona. Export visual deve usar `renderPath`/`segments` quando existirem e nunca conectar pausas/gaps. Corrida por zonas so desenha poligono se `zoneCoords` existir; rota de corrida por zonas sem poligono continua sendo rota, nao territorio inventado. Baixar imagem/PNG pede permissao de midia somente no clique de download. Story usa `socialHomeRepository.createRunStoryFromRun()` e salva item local `PENDING_SYNC` com `runSummary` seguro e `media` local opcional. `Copiar` fica fora da UI enquanto nao houver suporte confiavel para clipboard de imagem no build/plataforma.
**Consequencias:**

- GPS: nenhum recalc ou alteracao de path salvo.
- Mapa: share usa renderizacao visual e fallback local; mapa tile indisponivel nao impede o trace PNG.
- Firestore: nao participa de share/download/story local nesta etapa.
- Performance: imagem/PNG sao gerados sob demanda; arquivos antigos de cache podem ser limpos pelo helper existente.
- Experiencia do usuario: opcoes ficam claras, com loading/erro controlado e story local aparecendo na Home social.

## ADR-021: Central de debug local e diagnostico seguro

**Status:** aceito
**Contexto:** bugs reais de corrida ativa, GPS, background, notificacao, share, story, sync, territorio e ranking precisam ser investigados em aparelho fisico sem depender de Firestore, Sentry ou adb. O projeto ja tinha logs NDJSON, ZIP de corrida, Sentry sanitizado e tela `Configuracoes > Diagnostico`, mas faltava uma visao consolidada dos dominios local-first atuais.
**Decisao:** consolidar a central em `Configuracoes > Diagnostico`, usando `localDiagnosticsService` como agregador de resumos. A tela e o ZIP devem mostrar contadores e status de corrida ativa, GPS, permissoes, storage, sync, notificacao/background, Home social/stories/feed, compartilhamento, territorio e perfil/ranking/XP. O servico deve consumir facades existentes (`RunRepository`, `RunSyncQueueRepository`, `TerritoryRepository`, `SocialHomeRepository`, `ProgressionRepository`, `AchievementRepository`, `profileStats`, `permissions`, `activeRunTrackingService`) e nao criar fonte paralela.
**Politica:**

- Firestore e melhor esforco e nunca requisito para abrir Diagnostico ou exportar evidencia local.
- Diagnostico fica disponivel tambem em producao por causa de bugs reais de release, mas logs respeitam nivel reduzido e acoes perigosas ficam bloqueadas/confirmadas.
- Coordenadas exatas continuam desligadas por padrao; `rawPath` completo, tokens, emails completos, imagens privadas e payload completo de terceiros nao entram no resumo padrao.
- Export ZIP amplia o bundle existente com `localDiagnostics-summary.json` e `reports/*`, mantendo os NDJSON e artefatos antigos.
- Sentry complementa o diagnostico local e continua recebendo apenas contexto sanitizado.
- Logs de alta frequencia continuam no backend file-system/buffer; novo codigo nao deve usar AsyncStorage por ponto GPS.
- Limpeza de logs exige confirmacao e nao limpa corridas/runs.

**Consequencias:**

- Investigacao de corrida ativa/background/share/sync pode ser feita com um ZIP local unico.
- A tela evita parse pesado por render e mostra counts/amostras pequenas.
- Falha de uma secao do diagnostico nao derruba o export inteiro.
- Novos dominios local-first devem registrar resumo e logs na central antes de criar debug paralelo.

## ADR-022: Consolidar a rodada local-first na documentacao

**Status:** aceito
**Contexto:** depois das melhorias de corrida ativa, GPS/path, historico, sync, territorios, XP/conquistas, Perfil/Ranking, Home social, onboarding/permissoes, compartilhamento e diagnostico, parte da documentacao ainda descrevia o Wayper como Firestore-first ou deixava riscos pendentes espalhados. Isso aumentava a chance de futuras IAs ou implementacoes reativarem services legados, criarem repositories paralelos ou marcarem como concluido algo que ainda exige aparelho fisico/contrato remoto.
**Decisao:** manter `docs/24-resumo-rodada-local-first.md` como resumo operacional da rodada, sem substituir os documentos especificos. Atualizar roadmap, backlog, arquitetura, modelo de dados, fluxos, regras, testes, riscos e instrucoes de IA para refletir o codigo atual da branch `develop`: local-first nos fluxos consolidados, Firestore como remoto/best effort, stories/XP/territorio remoto ainda futuros e background ainda dependente de validacao fisica.
**Consequencias:**

- Futura IA/Codex deve ler codigo e docs antes de implementar e nao duplicar services/hooks/repositories/componentes existentes.
- `activeRunTrackingService`/`activeRunState`, `sync.js`/`runSyncQueueService`, repositories e storages oficiais ficam registrados como base atual.
- `runService.js`, `zones`/`@wayper_zones`, `xpService` e `MedalsWidget` seguem documentados como legado, nao como fonte nova.
- Roadmap/backlog passam a diferenciar implementado/avancado, pendente de validacao fisica e futuro remoto.
- A documentacao nao deve afirmar que background esta 100% validado, que Firestore foi removido ou que stories/XP/territorio ja possuem sync remoto completo.

## ADR-023: Diagnostico de emergencia durante corrida ativa

**Status:** aceito
**Contexto:** em corridas reais no Android, bugs de freeze podem travar parcial ou totalmente a UI da `MapScreen`, impedindo o usuario de abrir drawer/menu e navegar ate `Configuracoes > Diagnostico`. Sem um caminho direto, o bug mais critico fica sem evidencia local no momento em que acontece.
**Decisao:** adicionar um atalho de diagnostico de emergencia no overlay da corrida ativa (`MapScreen`), disponivel em `RUNNING` e `PAUSED`, usando o export ZIP existente com escopo `ACTIVE_RUN` e share sheet nativo. A corrida nao deve ser pausada/finalizada pelo export. Durante a corrida, salvar snapshots leves `EMERGENCY_RUN_DIAGNOSTIC_SNAPSHOT` no storage de diagnostico file-backed, com heartbeat de UI, timer, watcher, AppState, notificacao, counts de path/segments, motivos agregados de descarte, drawer attempts, stalls e ultimo erro. Coordenadas exatas e paths completos continuam fora do padrao.
**Politica:**

- Nao criar tracker GPS, storage, logger ou export paralelos.
- Firestore nao e requisito para diagnostico ou export.
- O atalho da corrida deve ficar acima do mapa e usar `hitSlop`/prioridade de toque clara.
- Gerar ZIP deve mostrar loading e erro controlado, sem bloquear a corrida nem depender de navegacao complexa.
- Drawer/header deve registrar `RUN_DRAWER_OPEN_REQUESTED`, `RUN_DRAWER_OPENED` e `RUN_DRAWER_OPEN_TIMEOUT` quando possivel.
- A acao de diagnostico na notificacao Android fica pendente enquanto o modulo nativo possuir uma unica acao contextual Pausar/Retomar.

**Consequencias:**

- Mesmo se o drawer travar, o usuario tem caminho direto para exportar evidencia da corrida ativa.
- O ZIP passa a incluir `emergencyRunDiagnostics.json` e `uiInteractionEvents.json`.
- Travamentos futuros devem diferenciar timer/UI stall, watcher morto, GPS sem pontos aceitos, drawer nao abrindo e render path sem atualizacao.
- A notificacao continua segura para Pausar/Retomar ate haver validacao fisica especifica para uma segunda acao.

## ADR-024: Obsidian como mente do projeto

**Status:** aceito
**Contexto:** o Wayper usa Markdown em `/docs` e `docs/wayper` como base de conhecimento integrada ao Obsidian. Rodadas anteriores consolidaram local-first, mas futuras alteracoes ainda poderiam atualizar codigo sem registrar bugs, ideias, propostas, decisoes ou riscos correspondentes.
**Decisao:** tratar os Markdown como memoria operacional do projeto. O codigo em `develop` continua sendo a fonte do que esta implementado; os docs registram intencao, historico, decisoes, bugs, ideias, propostas e proximos caminhos. Toda alteracao relevante deve consultar os docs antes de implementar, atualizar os documentos afetados depois e registrar pelo menos uma oportunidade real de melhoria relacionada quando houver impacto de produto/arquitetura/UX/operacao.
**Politica:**

- Codex pode sugerir, registrar e organizar.
- Codex nao pode aprovar sozinho, mover ideia para backlog ativo ou implementar proposta sem pedido explicito.
- Eduardo decide o que entra na proxima rodada.
- Bugs, ideias, propostas e ideias futuras usam IDs previsiveis e status rastreavel.
- Arquivos locais/visuais do Obsidian, como `workspace.json`, `graph.json`, cache, plugins e temas, ficam fora de escopo de commits.

**Consequencias:**

- `docs/14-instrucoes-para-ia.md` passa a conter o protocolo operacional completo.
- `docs/13-bugs-conhecidos.md`, `docs/16-ideias-de-melhoria.md`, `docs/17-propostas-pendentes.md` e `docs/wayper/12-ideias-futuras.md` viram registros estruturados.
- Futuras entregas precisam diferenciar implementado, em validacao, pendente de decisao, ideia futura, bug conhecido, proposta aprovada e proposta rejeitada.
- A documentacao nao deve afirmar validacao fisica, sync remoto ou decisao aprovada sem evidencia correspondente.

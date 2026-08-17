# Architecture Boundaries — Wayper mobile

> **Status:** vigente<br>
> **Escopo:** ownership e enforcement arquitetural progressivo<br>
> **Arquitetura do produto:** [`docs/04-arquitetura.md`](../04-arquitetura.md)<br>
> **Enforcement:** [`eslint.config.js`](../../eslint.config.js) e
> [`scripts/quality/check-architecture.mjs`](../../scripts/quality/check-architecture.mjs)<br>
> **Baseline:** [`scripts/quality/architecture-baseline.json`](../../scripts/quality/architecture-baseline.json)

Este documento formaliza fronteiras observadas no source. Não cria uma camada
nova, não exige repository para todo acesso e não transforma dívida atual em
refactor oportunista. A arquitetura de produto permanece em `docs/04`; aqui
ficam owners, exceções e a política operacional do gate.

## Modelo observado

| Domínio/camada | Paths observados | Responsabilidade | Dependências permitidas | Consumers atuais | Owner |
| --- | --- | --- | --- | --- | --- |
| UI | `src/screens`, `src/components`, `src/hooks` | render, input e composição de jornada | facades, services públicos, repositories e adapters de mapa | navegação/App | tela/componente correspondente |
| Shell | `App.js`, `index.js`, `src/navigation` | bootstrap, auth gate, root navigation e deep links | UI e APIs públicas de auth/runtime | plataforma | `MainNavigator`, entrypoints e services de shell |
| Application/services | `src/services` | casos de uso e owners por domínio já existentes | repositories, storage owner, Firebase quando o serviço é owner | UI, runtime e outros services | service temático existente |
| Run runtime | `src/services/runTracking`, `src/tasks/activeRunLocationTask.js`, services `run*` críticos | estado canônico, GPS, lifecycle, notification, recovery e finish | tracking, storage local e diagnostics; remoto só após save | `MapScreen`, shell e task headless | `activeRunTrackingService`, `activeRunRuntimeService` e owners de `run/` |
| Repositories | `src/repositories` | facade local/remote e contrato de dados por domínio | storage e services/SDKs do próprio domínio | UI e services | repository temático existente |
| Storage | `AsyncStorage`, FileSystem e helpers locais | durabilidade/cache/export com chave e schema conhecidos | plataforma e serialização | repositories/services; UI só nos casos registrados | repository/service que já possui a chave ou export |
| Firebase/remoto | `src/firebaseConfig.js`, imports `firebase/firestore` em owners registrados | Auth, remoto best effort e sync | SDK Firebase | repositories/services e dívida social inventariada | owner por domínio; nunca o runtime crítico |
| Native | `src/tasks`, `src/services/run/runNotificationService.js`, bridge Android | task headless, foreground service e notification actions | Expo/native bridge e runtime público | runtime/shell | task e notification service |
| Maps/geo | `src/services/tracking`, `src/services/territory`, `src/components/Map` | filtro/distância/path, geometria/captura e adaptação/render | Turf nos services; MapLibre no adapter UI | runtime, MapScreen e telas territoriais | services de tracking/territory e `WayperMapLibre` |
| Diagnostics | `src/services/diagnostics`, `DiagnosticsScreen` | observar, resumir, exportar e upload opt-in | APIs públicas de runtime e storages registrados | tela de diagnóstico e logger | services de diagnostics |
| Deferred/sync | `runDeferredTaskQueueService`, `runSyncQueueService`, repositories de fila, `src/utils/sync.js` | trabalho posterior, retry e Firestore best effort | save local já confirmado, repositories e remoto | finalization/deferred processors | filas e repositories existentes |
| Produto | feed, friends, profile, ranking, progression, territory | regra e composição temática | owners locais/remotos do domínio | UI e pós-corrida | services/repositories temáticos |

`MapScreen` é integração do fluxo crítico, não estado canônico. A existência de
`src/services` não significa que qualquer wrapper é owner: nome, responsabilidade,
callers, chave/schema e contrato precisam existir no source.

## Boundaries e decisão

| Boundary | From → to | Dívida atual | Risco de falso positivo | Decisão / severidade | Enforcement |
| --- | --- | ---: | --- | --- | --- |
| B1 | UI → AsyncStorage/storage internals | 3 refs legacy + 2 refs `MapScreen` | médio; export FileSystem em tela é legítimo hoje | `RATCHET_ONLY`; FileSystem export `DOCUMENT_ONLY` | AST por path e owner baseline |
| B2 | UI → `firebase/firestore` | 12 imports | baixo | `RATCHET_ONLY` | AST; novos arquivos ou crescimento falham |
| B3 | UI → state/task/tracking internals | 0 | baixo | `ERROR` | `no-restricted-imports` + ratchet |
| B4 | UI → `NativeModules`/TaskManager/notification internal | 0 | baixo | `ERROR` | `no-restricted-imports` + ratchet |
| B5 | services/repositories/storage/tasks/utils → UI/navigation | 0 | baixo | `ERROR` | `no-restricted-imports` + ratchet |
| B6 | repository/service → UI; “repository everywhere” | 0 no sentido proibido | alto para impor repository universal | B5 `ERROR`; regra universal `REJECT` | somente direção de dependência confiável |
| B7 | critical run owner → Firestore/config Firebase | 0 direto | baixo no import direto; alto no grafo transitivo global | `ERROR`; ordem local-first também é contrato/teste | ESLint + ratchet direto; workflow/testes para ordem |
| B8 | novo consumer → `runService`, `zoneService`, `zonesStorage`, `xpService` | 0 consumers de produção | baixo | `ERROR` | ESLint + ratchet; módulos permanecem |
| GEO | UI → Turf | 0 | baixo | `ERROR` | ESLint + ratchet; usar owner tracking/territory |
| Diagnostics | diagnostics → mutação interna de runtime | 0 confirmado | médio por método/call, não import | `DOCUMENT_ONLY` | review de API pública; leitura de snapshot é permitida |
| Cycles | ciclos globais | 31 arestas / 25 arquivos | alto, inclui barrels/aggregation | `MEASURE_ONLY` | `import/no-cycle` sob demanda; sem gate global |

O fechamento transitivo ingênuo de B7 foi rejeitado: diagnostics aggregation e
deferred work tornam Firestore estaticamente alcançável, mas esses caminhos não
são requisitos de start/tracking/save mínimo. O gate confiável bloqueia imports
diretos nos owners críticos. A ordem `save local -> deferred/sync` continua
coberta pelos contratos de finalization e testes de local-first.

## Inventário Firestore

Há 34 arquivos de produção com referência estática detectável a
`firebase/firestore`: 12 UI/hooks legados, 19 owners aprovados e 3 módulos
legados. Novo arquivo não entra nessa lista sem exceção owner-specific.

| Arquivo | Layer/domínio | Purpose | Current owner | Expected owner | Classificação |
| --- | --- | --- | --- | --- | --- |
| `src/components/Group/CreateGroupModal.js` | UI/social | criar grupo/membros | componente legado | owner de groups ainda não consolidado | `LEGACY_ALLOWED` |
| `src/components/Group/GroupChat.js` | UI/social | mensagens do grupo | componente legado | owner de groups ainda não consolidado | `LEGACY_ALLOWED` |
| `src/components/Group/GroupMembersList.js` | UI/social | perfis dos membros | componente legado | groups + user profile owner | `LEGACY_ALLOWED` |
| `src/hooks/useFriends.js` | UI/social | relações/lista de amigos | hook legado | `friendsService` | `MIGRATION_PENDING` |
| `src/hooks/useFriendsAdvanced.js` | UI/social | relações/presença de amigos | hook legado | `friendsService` | `MIGRATION_PENDING` |
| `src/screens/FeedScreen.js` | UI/social | feed/interações | tela legada | feed services/repository | `MIGRATION_PENDING` |
| `src/screens/Friends/FriendProfileScreen.js` | UI/social/profile | perfil público | tela legada | `UserProfileRepository`/friends | `MIGRATION_PENDING` |
| `src/screens/Friends/FriendRunsScreen.js` | UI/social/run | runs públicas do amigo | tela legada | friends/profile/run read owner | `MIGRATION_PENDING` |
| `src/screens/Friends/FriendsScreen.js` | UI/social | busca e relações | tela legada | `friendsService` | `MIGRATION_PENDING` |
| `src/screens/Group/GroupChatScreen.js` | UI/social | chat de grupo | tela legada | owner de groups ainda não consolidado | `LEGACY_ALLOWED` |
| `src/screens/Group/GroupDetailScreen.js` | UI/social | detalhe/membros do grupo | tela legada | owner de groups ainda não consolidado | `LEGACY_ALLOWED` |
| `src/screens/Group/GroupsScreen.js` | UI/social | lista/associação de grupos | tela legada | owner de groups ainda não consolidado | `LEGACY_ALLOWED` |
| `src/firebaseConfig.js` | infra/auth | inicialização/persistência Firebase | Firebase config | mesmo | `ALLOWED` |
| `src/repositories/rankingRepository.js` | repository/ranking | ranking remoto + cache/local | ranking repository | mesmo | `ALLOWED` |
| `src/repositories/userProfileRepository.js` | repository/profile | perfil público remoto + fallback | profile repository | mesmo | `ALLOWED` |
| `src/services/checkpoints/checkpointService.js` | service/checkpoints | checkpoints remotos do domínio | checkpoint service | mesmo | `ALLOWED` |
| `src/services/diagnostics/diagnosticUploadService.js` | service/diagnostics | upload opt-in | diagnostic upload | mesmo | `ALLOWED` |
| `src/services/feed/feedInteractionService.js` | service/social | interações do feed | feed interaction | mesmo | `ALLOWED` |
| `src/services/feed/feedPostActionsService.js` | service/social | ações/pending de posts | feed post actions | mesmo | `ALLOWED` |
| `src/services/feed/feedService.js` | service/social | consulta/cache do feed | feed service | mesmo | `ALLOWED` |
| `src/services/friends/friendsService.js` | service/social | relações de amizade | friends service | mesmo | `ALLOWED` |
| `src/services/notifications/notificationService.js` | service/social | notificações remotas | notification service | mesmo | `ALLOWED` |
| `src/services/profile/profileService.js` | service/profile | perfil remoto/local | profile service | repository em evolução, sem migração nesta unidade | `ALLOWED` |
| `src/services/ranking/fetchFirestore.js` | service/ranking | adapter de consulta | ranking service | ranking repository/service | `ALLOWED` |
| `src/services/ranking/ranking.localLeaders.js` | service/ranking | líderes remotos + fallback | ranking service | ranking repository/service | `ALLOWED` |
| `src/services/territory/territoryFeedService.js` | service/territory | feed territorial remoto | territory feed service | mesmo | `ALLOWED` |
| `src/services/territory/territoryMigrationService.js` | service/territory | migração best effort | territory migration | mesmo | `ALLOWED` |
| `src/services/territory/territoryStatsService.js` | service/territory | estatística remota best effort | territory stats | mesmo | `ALLOWED` |
| `src/services/territory/territoryStorageService.js` | service/territory | storage local + sync remoto | territory storage | `TerritoryRepository`/service atual | `ALLOWED` |
| `src/services/userService.js` | service/profile | dados remotos de usuário | user service | profile owner em evolução | `ALLOWED` |
| `src/utils/sync.js` | sync/run | histórico local e sync remoto pós-save | sync owner legado canônico | `RunRepository`/queue sobre este owner | `ALLOWED` |
| `src/services/runService.js` | legacy/run | API anterior de runs | módulo de compatibilidade | `RunRepository` + finalization/sync | `LEGACY_ALLOWED` |
| `src/services/xp/xpService.js` | legacy/progression | XP remoto/anterior | módulo legado | `ProgressionRepository` | `LEGACY_ALLOWED` |
| `src/services/zones/zoneService.js` | legacy/territory | zonas remotas antigas | módulo legado | `TerritoryRepository` | `LEGACY_ALLOWED` |

Por domínio: social 17; profile 3; ranking 3; territory 5; diagnostics 1;
checkpoint/infra 2; run/sync 2; XP legado 1. O critical run path possui zero
import direto de Firestore.

## Inventário de storage baixo nível

### AsyncStorage e caminhos locais expostos à UI

| Arquivo | Layer/domínio | Purpose | Canonical owner | Classificação |
| --- | --- | --- | --- | --- |
| `src/components/MedalsWidget.js` | UI/progression | medals legado + chamada a sync | `ProgressionRepository`/`AchievementRepository` | `MIGRATION_PENDING` |
| `src/screens/Runs/DashboardScreen.js` | UI/run | acionar sync via `utils/sync` | sync queue/repository | `MIGRATION_PENDING` |
| `src/screens/MapScreen.js` | UI/run | draft local e handoff de sync/finalization | integração `MapScreen` + `runFinalizationService` | `LEGACY_ALLOWED` (exceção limitada a 2) |
| `src/firebaseConfig.js` | infra/auth | persistência da sessão Firebase | Firebase config | `ALLOWED` |
| `src/repositories/achievementRepository.js` | repository/progression | conquistas locais | mesmo | `ALLOWED` |
| `src/repositories/localMetadataRepository.js` | repository/storage | metadata/schema de migração | mesmo | `ALLOWED` |
| `src/repositories/progressionRepository.js` | repository/progression | XP/progresso local | mesmo | `ALLOWED` |
| `src/repositories/rankingRepository.js` | repository/ranking | cache de ranking | mesmo | `ALLOWED` |
| `src/repositories/socialHomeRepository.js` | repository/social | stories/cache da Home | mesmo | `ALLOWED` |
| `src/repositories/territoryRepository.js` | repository/territory | territórios/eventos/leaderboards locais | mesmo | `ALLOWED` |
| `src/services/checkpoints/checkpointService.js` | service/checkpoints | checkpoint do domínio | mesmo | `ALLOWED` |
| `src/services/diagnostics/diagnosticsPreferencesService.js` | diagnostics | consentimento/preferências | mesmo | `ALLOWED` |
| `src/services/diagnostics/localDiagnosticsService.js` | diagnostics | leitura agregada registrada | mesmo | `ALLOWED` |
| `src/services/diagnostics/logStorageService.js` | diagnostics | metadata/buffer de logs | mesmo | `ALLOWED` |
| `src/services/feed/feedPostActionsService.js` | social | pending actions/cache | mesmo | `ALLOWED` |
| `src/services/feed/feedService.js` | social | cache do feed | mesmo | `ALLOWED` |
| `src/services/location/locationService.js` | location | estado local de localização | mesmo | `ALLOWED` |
| `src/services/onboarding/onboardingService.js` | shell | estado de onboarding | mesmo | `ALLOWED` |
| `src/services/permissions.js` | shell | estado/decisões de permissão | mesmo | `ALLOWED` |
| `src/services/profile/profileService.js` | profile | fallback/cache de perfil | mesmo | `ALLOWED` |
| `src/services/run/runDeferredTaskQueueService.js` | run/deferred | fila derivada durável | mesmo | `ALLOWED` |
| `src/services/runOfflineStorageService.js` | run/storage | draft/compatibilidade offline | mesmo | `ALLOWED` |
| `src/services/runTracking/activeRunTrackingService.js` | run/runtime | snapshot canônico ativo | active run tracking | `ALLOWED` |
| `src/services/territory/territoryMigrationService.js` | territory | estado de migração | mesmo | `ALLOWED` |
| `src/services/territory/territoryStorageService.js` | territory | storage territorial atual | territory repository/service | `ALLOWED` |
| `src/utils/sync.js` | run/sync | histórico local `runs` | `RunRepository` sobre sync atual | `ALLOWED` |
| `src/services/runService.js` | legacy/run | storage/API antiga | `RunRepository` | `LEGACY_ALLOWED` |
| `src/services/xp/xpService.js` | legacy/progression | XP anterior | `ProgressionRepository` | `LEGACY_ALLOWED` |
| `src/services/zones/zoneService.js` | legacy/territory | zonas antigas | `TerritoryRepository` | `LEGACY_ALLOWED` |
| `src/storage/zonesStorage.js` | legacy/territory | chave antiga de zonas | `TerritoryRepository` | `LEGACY_ALLOWED` |

### FileSystem e SQLite

| Arquivo | Layer/domínio | Purpose | Canonical owner | Classificação |
| --- | --- | --- | --- | --- |
| `src/screens/Friends/FriendRunsScreen.js` | UI/export | arquivo GPX temporário para share | fluxo de export da própria tela; facade inexistente | `ALLOWED` |
| `src/screens/Runs/ZoneDetailScreen.js` | UI/export | GeoJSON/text temporário para share | fluxo de export da própria tela; facade inexistente | `ALLOWED` |
| `src/services/diagnostics/diagnosticExportService.js` | diagnostics | bundle ZIP local | mesmo | `ALLOWED` |
| `src/services/diagnostics/logStorageService.js` | diagnostics | NDJSON rotativo | mesmo | `ALLOWED` |
| `src/utils/fileSystemLegacy.js` | compatibilidade FileSystem | adapter da API legacy | mesmo, revisar com upgrade Expo | `ALLOWED` |

Não há import de SQLite em produção. As duas telas de export não foram movidas:
não existe owner canônico para esses arquivos efêmeros e criar facade só para o
lint seria arquitetura artificial.

## Ownership do runtime

| Responsabilidade | Owner confirmado | Contrato |
| --- | --- | --- |
| canonical state | `activeRunState.js` mantido por `activeRunTrackingService` | UI nunca é fonte de verdade |
| tracking/GPS | `activeRunTrackingService.js` | ingere, filtra e persiste snapshot; API pública para UI/runtime |
| orchestration/lifecycle | `activeRunRuntimeService.js` | reconcilia AppState, recovery e notification |
| background task | `src/tasks/activeRunLocationTask.js` | task global entrega lotes ao owner |
| notification/native | `runNotificationService.js` + bridge Android | foreground service e actions; UI não usa bridge direto |
| recovery | `runRecoveryService.js` | reconcilia tracking e draft offline |
| finalization | `runFinalizationService.js` | snapshot e save mínimo idempotente antes de cleanup/enqueue |
| offline save/draft | `activeRunTrackingService`, `runOfflineStorageService`, `sync.saveLocalRun` via adapter injetado | Firestore não bloqueia preservação |
| deferred work | `runDeferredTaskQueueService.js` + repository | território/XP/outros derivados depois do save |
| sync remoto | `runSyncQueueService.js`, repository e `utils/sync.js` | retry posterior; `SYNC_FAILED` preserva local |

Qualquer import de state/task/native internals fora desses owners é bypass. A
`MapScreen` pode usar `activeRunTrackingService` e `activeRunRuntimeService` como
facades públicas atuais; proibi-los quebraria a composição real.

## Ownership geo

| Concern | Owner confirmado | UI permitida |
| --- | --- | --- |
| ingestão/filtros/distância/segments/render path | `src/services/tracking` e `src/services/runTracking` | consumir snapshot/path público |
| geometria Turf/normalização | `territoryGeometryService.js` | chamar service, não importar Turf |
| captura | `territoryCaptureService.js` | disparar fluxo aprovado pós-save |
| storage/query territorial | `territoryStorageService.js` e `TerritoryRepository` | ler por owner |
| MapLibre data/render | `territoryMapService.js` e `WayperMapLibre.js` | montar layers/props sem duplicar cálculo de domínio |

## Legacy modules

`runService.js`, `services/zones/zoneService.js`, `storage/zonesStorage.js` e
`services/xp/xpService.js` permanecem para compatibilidade/migração. Eles têm
zero consumers de produção; qualquer novo import/export/`require`/dynamic import
falha. Os módulos não foram apagados nem seus dados migrados nesta unidade.

## Ratchet e exceções

`npm run quality:architecture` usa o parser do ESLint já instalado; não usa regex
para decidir imports e não percorre `node_modules`. Detecta import/export,
`require()` e dynamic import estáticos. O baseline guarda apenas paths e limites:

- dívida pode manter ou reduzir sua contagem, nunca aumentar;
- owners aprovados podem manter a referência já observada, não criar consumers;
- categoria com baseline zero falha na primeira ocorrência;
- baseline não tem comando de atualização automática;
- `--details` mostra cada referência; output normal mostra somente totais.

Uma exceção precisa de `path`, `max`, `boundary`, `reason`, `owner` e
`reviewCondition`. Wildcard é inválido. A única exceção atual é `MapScreen`,
limitada às duas referências existentes de draft/sync. Uma exceção aceita no
ratchet também exige override ESLint específico se a boundary tiver `ERROR`.

## Anti-gaming

Não são exceções válidas: re-export intermediário, alias artificial, trocar
`import` por `require`/dynamic import, mover SDK/storage para helper sem owner ou
wrapper que apenas repassa chamada. O gate fixa todos os 34 importers Firestore e
32 importers raw-storage atuais; um arquivo novo falha mesmo fora da UI. Imports
computados não estáticos e responsabilidade semântica continuam review humano —
não justificam construir uma DSL ou parser próprio.

## Evals e comandos

`node --test scripts/quality/check-architecture.test.mjs` cobre 10 casos
positivos/policy, 8 negativos/anti-falso-positivo e 6 casos do ratchet. A suíte
de routing permanece em `routing-evals.md`; architecture evals não alteram a
baseline Jest do produto.

Comandos canônicos:

```bash
npm run lint
npm run quality:size
npm run quality:architecture
node --test scripts/quality/check-code-size.test.mjs scripts/quality/check-architecture.test.mjs
```

# Modelo de Dados

Modelo consolidado a partir do código atual. Firestore continua documentado como remoto/destino posterior, mas o app possui fontes locais oficiais para corrida ativa, histórico, territórios, XP/conquistas, stories, ranking/cache, perfil e diagnóstico.

## Coleções sugeridas

```txt
users/{userId}
runs/{runId}
zones/{zoneId}
rankings/{rankingId}
friendships/{friendshipId}
groups/{groupId}
groups/{groupId}/members/{userId}
groups/{groupId}/rankings/{rankingId}
```

## users

Representa o usuário do app.

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | string | Mesmo UID do Firebase Auth. |
| `displayName` | string | Nome público. |
| `email` | string | Email, se permitido pelas regras de privacidade. |
| `photoURL` | string/null | Foto de perfil. |
| `createdAt` | timestamp | Data de criação. |
| `updatedAt` | timestamp | Última atualização. |
| `totalDistanceMeters` | number | Distância total registrada. |
| `totalAreaM2` | number | Área total conquistada. |
| `totalZones` | number | Número de zonas conquistadas. |
| `level` | number | Nível gamificado, se usado. |

## runs

Representa uma corrida registrada.

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | string | ID da corrida. |
| `userId` | string | Dono da corrida. |
| `startedAt` | timestamp | Início. |
| `endedAt` | timestamp | Fim. |
| `durationSeconds` | number | Duração. |
| `distanceMeters` | number | Distância. |
| `averagePace` | number | Ritmo médio. |
| `averageSpeed` | number | Velocidade média. |
| `route` | array | Pontos GPS simplificados ou referência para rota. |
| `status` | string | `completed`, `discarded`, `invalid`, etc. |
| `createdAt` | timestamp | Criação do registro. |

### runs locais

No app, a fonte local do historico usa a chave `runs` do AsyncStorage via `sync.js`. Ela precisa preservar mais campos que o resumo remoto minimo:

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `id` | string | Chave estavel usada pela UI local. |
| `localRunId` | string | ID local/idempotente da corrida, usado para dedupe e retry. |
| `remoteRunId` | string/null | ID remoto quando a corrida ja sincronizou ou foi vinculada ao Firestore. |
| `userId` | string | Dono local/remoto da corrida. |
| `mode` | string | `free`, `zones` ou equivalente legado. |
| `startedAt` | ISO string/null | Inicio da corrida. |
| `finishedAt`/`endedAt` | ISO string/null | Finalizacao da corrida. |
| `date` | ISO string | Data de ordenacao do historico, preferencialmente fim da corrida. |
| `distance`/`distanceMeters` | number | Distancia oficial salva, baseada no `trustedPath`. |
| `duration`/`durationSeconds` | number | Duracao oficial salva. |
| `syncStatus` | string | `PENDING`, `SYNCING`, `SYNCED` ou `FAILED`. |
| `offlineStatus` | string | `PENDING_SYNC`, `SYNCING`, `SYNCED`, `SYNC_FAILED` ou `LOCAL_ONLY`. |
| `syncAttempts`/`retryCount` | number | Quantidade de tentativas de envio remoto. |
| `lastSyncAttemptAt` | ISO string/null | Ultima tentativa de sync remoto. |
| `lastSyncedAt`/`syncedAt` | ISO string/null | Momento do ultimo sucesso remoto. |
| `lastSyncError`/`syncError` | string/null | Erro controlado de sync, sem apagar a corrida local. |
| `syncErrorType` | string/null | Categoria do erro (`temporary`, `permission_denied`, `validation`, etc.). |
| `syncErrorRecoverable` | boolean | Define se a fila deve tentar novamente automaticamente. |
| `trustedPath` | array | Pontos aceitos para metricas. |
| `renderPath` | array | Pontos preparados para visualizacao. |
| `rawPath` | array | Pontos brutos/diagnostico. |
| `segments`/`routeSegments` | array | Quebras de pausa/gap para mapa, replay e compartilhamento. |
| `area`/`areaM2` | number | Area territorial quando `mode=zones`. |
| `zoneCoords`/`geometry` | array/object | Dados territoriais quando existirem. |

Regras locais:

- Firestore nao e necessario para listar ou abrir detalhes de corrida salva localmente.
- Dedupe considera `id`, `localRunId`, `remoteRunId`, `runId` e `legacyId`.
- Registros `RUNNING`, `PAUSED`, `RECOVERING` ou `FINISHING` nao devem aparecer como finalizados.
- Se uma corrida sincronizada reaparecer com `remoteRunId`, a copia local deve ser atualizada, nao duplicada.
- A fila local de sync parte da mesma lista `runs`; nao existe storage paralelo oficial para runs finalizadas.
- `remoteRunId` define o documento remoto quando existir; sem ele, `localRunId` e usado como chave idempotente depois de uma busca remota por `localRunId`.
- A copia local preserva path completo. O payload remoto pode limitar arrays por `ROUTE_CAP` e registrar `remoteRouteLimits`.

## corrida ativa local

Durante a atividade, a fonte canonica e `wayper:activeRun:v2`, mantida por `activeRunTrackingService` e modelada por `activeRunState`.

Campos esperados no snapshot canonico:

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `activeRunId`/`id`/`localRunId` | string | Identidade local estavel da corrida ativa. |
| `userId` | string/null | Usuario dono quando autenticado. |
| `status` | string | `RUNNING`, `PAUSED`, `RECOVERING`, `ERROR_RECOVERABLE`, `FINISHED` ou equivalente canonico. |
| `startedAt` | ISO/number | Inicio da corrida. |
| `pausedAt` | ISO/number/null | Momento da pausa atual, se existir. |
| `finishedAt` | ISO/number/null | Momento de finalizacao. |
| `elapsedMs`/`durationSeconds` | number | Duracao consolidada, protegida contra regressao. |
| `distanceMeters` | number | Distancia oficial da corrida ativa, baseada em `trustedPath`. |
| `rawPath` | array | Pontos normalizados para diagnostico. |
| `trustedPath` | array | Pontos aceitos para metrica. |
| `renderPath`/`displayPoints` | array | Pontos visuais/simplificados. |
| `segments`/`routeSegments` | array | Segmentos para pausa/gap sem conectar linha falsa. |
| `checkpointAt`/`lastUpdatedAt` | ISO/number | Controle de frescor para recovery. |
| `schemaVersion` | number | Versao do schema local. |

Regras:

- `FINISHING` e estado terminal para recovery; nao pode voltar como corrida ativa.
- `runRecoveryService` decide conflitos entre `wayper:activeRun:v2` e `wayper_active_offline_run_v1`.
- Snapshot antigo nao deve reduzir tempo, distancia, pontos ou geometria viva.
- O legado `wayper_active_offline_run_v1` e checkpoint/compatibilidade, nao fonte nova.
- Firestore nao participa de start, pause, resume, ponto GPS, metrica ou finish da corrida ativa.

## route point

Formato sugerido para pontos de rota.

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `lat` | number | Latitude. |
| `lng` | number | Longitude. |
| `timestamp` | timestamp/number | Momento da captura. |
| `accuracy` | number/null | Precisão do GPS. |
| `speed` | number/null | Velocidade reportada. |

## zones

Representa uma zona conquistada.

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | string | ID da zona. |
| `userId` | string | Usuário dono. |
| `runId` | string | Corrida que gerou a zona. |
| `geometry` | object | GeoJSON Polygon/MultiPolygon. |
| `areaM2` | number | Área calculada. |
| `createdAt` | timestamp | Criação. |
| `status` | string | `active`, `contested`, `removed`, etc. |

## territories locais

No app, territorios atuais nao usam `zones` como storage local novo. A fonte local oficial e `wayper_territories_v1`, acessada por `TerritoryRepository` e `territoryStorageService`.

Campos locais esperados, preservando compatibilidade com dados antigos:

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `id` | string | ID estavel do territorio local. |
| `localId` | string/null | Identidade local normalizada; por padrao usa `id`. |
| `remoteId` | string/null | ID remoto quando houver sync territorial. |
| `ownerId`/`userId` | string | Usuario dono do territorio. |
| `runId`/`runLocalId` | string/null | Corrida local que gerou a captura. |
| `runRemoteId` | string/null | Corrida remota relacionada, quando existir. |
| `geometry` | object/null | GeoJSON `Polygon` ou `MultiPolygon` calculado pela captura. |
| `routeGeometry` | object/null | GeoJSON da rota/segmentos usada para visualizacao/auditoria. |
| `zoneCoords`/`coordsPreview` | array | Preview visual do poligono. |
| `area`/`areaM2` | number | Area territorial calculada em metros quadrados. |
| `cellIds` | array | Celulas afetadas para leaderboard/cache territorial. |
| `territorySummary` | object/null | Resumo derivado da corrida por zonas quando salvo junto da run. |
| `status` | string | `active`, `deleted`, `conquered` ou equivalente local. |
| `syncStatus` | string | `PENDING`, `SYNCING`, `SYNCED` ou `FAILED`. |
| `offlineStatus` | string | `PENDING_SYNC`, `SYNCING`, `SYNCED` ou `SYNC_FAILED`. |
| `pendingSync`/`synced` | boolean | Compatibilidade com fila local atual. |
| `schemaVersion`/`version` | number | Versao de schema/entidade. |
| `createdAt`/`updatedAt` | ISO string | Datas locais preservadas pela normalizacao. |

Eventos territoriais usam `wayper_territory_events_v1` e devem carregar `id/localId`, `territoryId`, `runId/runLocalId`, `actorId`, `targetId`, `type`, `affectedAreaM2`, `cellIds`, `syncStatus`, `offlineStatus`, `createdAt` e `schemaVersion` quando aplicavel.

Leaderboards territoriais usam `wayper_territory_leaderboards_v1` como cache/local e nao devem ser mostrados como ranking remoto real sem origem identificada.

Regras:

- Corrida por zonas preserva `area`, `areaM2`, `zoneCoords`, `geometry`, `routeGeometry`, `territorySummary`, `territoryEvents` e `capturedCells` quando a captura local retorna sucesso.
- Corrida livre normalizada localmente deve zerar/remover campos territoriais falsos.
- `zones` e `@wayper_zones` so entram por migracao/compatibilidade explicita; novo codigo nao deve gravar neles.
- Migracao local nao apaga legado nesta fase.

## progresso, XP e conquistas locais

A gamificacao local-first usa AsyncStorage e repositories dedicados. Firestore e destino futuro/melhor esforco, nao requisito para calcular progresso local.

### `wayper_user_progress_v1`

Representa o agregado local de progresso do usuario.

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `localId` | string | ID local estavel, por padrao `progress:{userId}`. |
| `remoteId` | string/null | ID remoto futuro, quando houver sync. |
| `userId` | string | Usuario dono do progresso; `offline` pode ser usado sem Auth. |
| `source` | string | Origem do agregado, normalmente `local`. |
| `totalXp` | number | XP total acumulado por eventos locais validos. |
| `level` | number | Nivel derivado de `totalXp`. |
| `xp` | number | XP dentro do nivel atual. |
| `nextLevelXp` | number | XP necessario dentro do nivel atual para subir. |
| `progressToNextLevel` | number | Progresso decimal de 0 a 1. |
| `totalRuns` | number | Corridas validas processadas para XP. |
| `totalDistanceMeters` | number | Distancia total de corridas validas. |
| `totalDurationSeconds` | number | Duracao total de corridas validas. |
| `freeRuns`/`zoneRuns` | number | Totais por modo. |
| `territoryCaptures` | number | Corridas por zonas com XP territorial valido. |
| `totalTerritoryAreaM2` | number | Area territorial valida usada para progresso. |
| `totalCapturedCells` | number | Celulas capturadas usadas para progresso. |
| `processedRunIds` | array | Runs ja processadas. |
| `processedRunEventTypes` | object | Dedupe fino por `runId:eventType`. |
| `syncStatus` | string | `PENDING`, `SYNCED` ou `FAILED`. |
| `offlineStatus` | string | `LOCAL_ONLY`, `PENDING_SYNC`, `SYNCED` ou `SYNC_FAILED`. |
| `schemaVersion` | number | Versao do schema local. |
| `createdAt`/`updatedAt` | ISO string | Datas locais. |
| `lastSyncAttemptAt`/`lastSyncedAt` | ISO string/null | Controle de sync futuro. |
| `syncError` | string/null | Erro controlado de sync futuro. |

### `wayper_xp_events_v1`

Representa eventos locais auditaveis de XP.

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `id`/`localId` | string | ID deterministico `xp:{userId}:{runId}:{type}`. |
| `remoteId` | string/null | ID remoto futuro. |
| `userId` | string | Usuario dono. |
| `type` | string | `RUN_COMPLETED`, `DISTANCE_RUN`, `DURATION_RUN`, `FIRST_RUN`, `ZONE_RUN_COMPLETED` ou `TERRITORY_CAPTURED`. |
| `source` | string | Origem, normalmente `run`. |
| `sourceRunId`/`localRunId` | string | Corrida local que gerou o evento. |
| `xpAmount` | number | XP aplicado pelo evento. |
| `metadata` | object | Metricas seguras usadas no calculo. |
| `syncStatus` | string | `PENDING`, `SYNCED` ou `FAILED`. |
| `offlineStatus` | string | `LOCAL_ONLY`, `PENDING_SYNC`, `SYNCED` ou `SYNC_FAILED`. |
| `schemaVersion` | number | Versao do schema local. |
| `createdAt`/`updatedAt` | ISO string | Datas locais. |
| `lastSyncAttemptAt`/`syncError` | ISO string/string/null | Controle de sync futuro. |

### `wayper_achievements_v1`

Representa conquistas desbloqueadas. O catalogo inicial fica no codigo em `AchievementRepository`.

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `id` | string | ID da conquista do catalogo. |
| `localId` | string | ID local da conquista desbloqueada. |
| `remoteId` | string/null | ID remoto futuro. |
| `userId` | string | Usuario dono. |
| `type` | string | Tipo de conquista (`run`, `distance`, `zone_run`, `territory`, `duration`). |
| `source` | string | Origem, normalmente `local`. |
| `progress` | number | Progresso no momento do desbloqueio. |
| `target` | number | Alvo do catalogo. |
| `unlockedAt` | ISO string | Momento do desbloqueio local. |
| `syncStatus` | string | `PENDING`, `SYNCED` ou `FAILED`. |
| `offlineStatus` | string | `PENDING_SYNC`, `SYNCED` ou `SYNC_FAILED`. |
| `schemaVersion` | number | Versao do schema local. |
| `createdAt`/`updatedAt` | ISO string | Datas locais. |
| `lastSyncAttemptAt`/`syncError` | ISO string/string/null | Controle de sync futuro. |

### `wayper_achievement_progress_v1`

Representa progresso parcial por conquista, mesmo sem desbloqueio.
As entradas devem ser chaveadas por `userId:achievementId` para evitar mistura de progresso entre usuarios no mesmo aparelho; leituras podem aceitar entrada legada por `achievementId` somente quando ela nao tiver outro `userId`.

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `id`/`localId` | string | ID da conquista. |
| `userId` | string | Usuario dono. |
| `progress` | number | Valor atual da metrica. |
| `target` | number | Alvo da conquista. |
| `unlocked` | boolean | Indicador derivado/preservado quando aplicavel. |
| `syncStatus`/`offlineStatus` | string | Controle local para sync futuro. |
| `schemaVersion` | number | Versao do schema local. |
| `createdAt`/`updatedAt` | ISO string | Datas locais. |

Regras:

- Corrida finalizada valida pode gerar XP; corrida ativa, `FINISHING`, descartada, invalida ou suspeita nao gera XP.
- XP e idempotente por `sourceRunId/localRunId` e tipo de evento.
- Conquista desbloqueada e idempotente por `userId + id`.
- Storage corrompido deve retornar estado inicial controlado e nao quebrar o app.
- Dados demo/mock nao entram no progresso real.
- `medals`, `@wayper:medals_awarded_v1` e colecao remota `medals` sao legado visual; nao substituem `wayper_achievements_v1`.

## estatisticas locais de perfil

As estatisticas exibidas no perfil sao uma visao derivada, nao um novo storage. A consolidacao fica em `src/repositories/profileStats.js` e le fontes locais reais:

| Fonte | Uso |
| --- | --- |
| `RunRepository` / `runs` | Total de corridas finalizadas, distancia, duracao, pace medio, melhor pace, maior corrida, corridas livres e corridas por zonas. |
| `TerritoryRepository` / `wayper_territories_v1` | Area territorial atual, quantidade de territorios/zonas locais e celulas capturadas. |
| `ProgressionRepository` / `wayper_user_progress_v1` | `totalXp`, `xp`, nivel e progresso para o proximo nivel. |
| `AchievementRepository` / `wayper_achievements_v1` | Total de conquistas, conquistas desbloqueadas e conquistas recentes. |

Regras da visao local:

- Corrida ativa, `RUNNING`, `PAUSED`, `RECOVERING` ou `FINISHING` nao entra em estatistica finalizada.
- Corrida invalida, cancelada, removida ou suspeita nao entra.
- Corrida pendente de sync ou com `SYNC_FAILED` conta como dado local real.
- Dedupe usa `localRunId`, `remoteRunId`, `id`, `runId` e `legacyId`.
- Registros com `userId`/`ownerId` diferente do usuario atual nao entram.
- Corrida livre nao soma territorio falso; area de corrida so entra quando `mode=zones`.
- `pendingSyncCount` e `failedSyncCount` sao expostos para a UI sem apagar os dados locais.

## Home social local-first

`src/repositories/socialHomeRepository.js` monta a visao social de `Inicio`. A tela nao acessa Firestore diretamente e nao usa mock/demo como dado real.

Campos principais da visao:

| Campo | Origem | Observacao |
| --- | --- | --- |
| `profile` | `UserProfileRepository` | Perfil/avatar local/cacheado para o atalho "Seu story". |
| `activeRun` | `activeRunTrackingService` | Apenas para navegar ao `Mapa` quando houver corrida preservada. |
| `stories` | `wayper_run_stories_v1` | Stories locais/cacheados de corrida; remoto futuro deve entrar por repository. |
| `friends` / `friendActivity` | `feedService` | Amigos reais/cacheados; presenca so aparece com dado de presenca. |
| `feedItems` | `feedService` + `wayper_activity_feed_cache_v1` + stories locais | Atividades normalizadas para cards sociais. |
| `myRecentRunsForStory` | `RunRepository` | Corridas finalizadas do usuario, sem ativa/`FINISHING`, para adicionar ao story. |
| `pendingStoryUploads` | `wayper_run_stories_v1` | Stories locais com `syncStatus=PENDING_SYNC`. |
| `source` | derivado | `remote`, `cache`, `local` ou `empty`; nunca `demo` na Home. |
| `states` | derivado | Estados vazios/offline/cache para stories, amigos, feed e corridas postaveis. |

### `wayper_run_stories_v1`

Story local de corrida:

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `localId` | string | ID local do story. |
| `remoteId` | string/null | ID remoto futuro, quando houver sync. |
| `userId` | string | Dono do story. |
| `actor` | object | Nome/avatar/username seguros para UI. |
| `runLocalId` | string/null | Corrida local associada. |
| `runRemoteId` | string/null | Corrida remota associada, se existir. |
| `type` | string | `run_card` nesta etapa. |
| `visibility` | string | `friends` por padrao. |
| `createdAt` | ISO string | Criacao local. |
| `expiresAt` | ISO string/null | Expiracao local opcional. |
| `media` | object/null | Referencia futura a imagem/tracado, sem gerar remoto falso. |
| `runSummary` | object | Resumo seguro da corrida, sem exigir rawPath. |
| `syncStatus` | string | `PENDING_SYNC`, `SYNCED`, `SYNC_FAILED` ou `LOCAL_ONLY`. |
| `source` | string | `local`, `cache` ou `remote`. |
| `schemaVersion` | number | Versao do schema. |

`runSummary` deve conter apenas identificadores e metricas seguras: `id/localRunId/remoteRunId`, `mode`, `distanceMeters`, `durationSeconds`, `paceSecondsPerKm`, `territoryAreaM2` quando `mode=zones`, `finishedAt`, `syncStatus` e `source`. Nao duplicar rota bruta se um preview/resumo resolver.

`media`, quando existir, deve ser referencia local segura criada pelo fluxo de compartilhamento:

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `type` | string | `share_image` ou `trace_png`. |
| `kind` | string | `image` ou `trace`. |
| `uri` | string | URI local do PNG gerado. |
| `mimeType` | string | `image/png`. |
| `source` | string | `local` nesta etapa. |
| `filenameBase` | string/null | Nome base legivel usado no export. |
| `width`/`height` | number/null | Dimensoes quando conhecidas. |
| `createdAt` | ISO string/null | Criacao local da midia. |

`media` nao deve carregar `rawPath`, `trustedPath`, `renderPath`, `segments`, erros de sync, storage keys ou payloads internos. Se a midia local expirar no cache, o story continua valido com `runSummary`.

### `wayper_activity_feed_cache_v1`

Cache normalizado de feed para abrir a Home sem remoto:

| Campo | Tipo | Descricao |
| --- | --- | --- |
| `id`/`activityId` | string | ID local/remoto do item. |
| `remoteId` | string/null | ID remoto quando existir. |
| `userId` | string | Autor da atividade. |
| `type` | string | `run` ou `zone`. |
| `createdAt` | ISO string | Data de exibicao. |
| `payload`/campos normalizados | object | Metricas e preview seguros do feed. |
| `source` | string | `remote`, `cache` ou `local`. |
| `syncStatus`/`cacheStatus` | string/null | Status quando aplicavel. |
| `schemaVersion` | number | Versao do schema. |

Regras:

- Falha remota nao apaga cache local.
- Cache antigo deve aparecer como cache, nao como remoto.
- Demo/mock so pode existir em fluxo dev opt-in fora da Home; `socialHomeRepository` filtra `demo`.
- Story local vira item de feed local, mas continua `PENDING_SYNC` ate existir publicacao remota real.
- Corrida ativa, `RUNNING`, `PAUSED`, `RECOVERING` ou `FINISHING` nao entra em `myRecentRunsForStory`.

## rankings

Representa rankings agregados.

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | string | Exemplo: `global_area_monthly_2026_05`. |
| `type` | string | `area`, `zones`, `distance`. |
| `period` | string | `global`, `weekly`, `monthly`. |
| `entries` | array | Lista resumida de usuários e pontuações. |
| `updatedAt` | timestamp | Última atualização. |

No app, `RankingRepository` sempre retorna origem explicita:

| Source | Significado |
| --- | --- |
| `remote` | Dados vindos do service remoto de ranking e elegiveis para cache. |
| `cache` | Ultimo ranking remoto salvo em `wayper:rankingCache:v1:*`; deve carregar `updatedAt`/`cachedAt`. |
| `local` | Ranking limitado calculado com dados locais reais, normalmente apenas o usuario do aparelho ou leaderboards territoriais locais. |
| `empty` | Sem dados reais suficientes para o criterio/periodo solicitado. |
| `demo` | Dados de demonstracao, somente opt-in/dev; nunca substituem remoto/cache/local silenciosamente. |

Ranking local por distancia usa `RunRepository`; por XP usa `ProgressionRepository`; por area/territorio usa `TerritoryRepository` e dados territoriais reais. Cache remoto pode ser combinado com a linha local do proprio usuario, mas a identidade do usuario nao pode aparecer duplicada.

## Metadados locais e repositories

A camada local-first incremental usa `wayper:localMetadata:v1` para registrar schema version por dominio, migrations executadas uma vez e storages legados marcados como deprecated.

Storages locais preservados:

| Dominio | Storage | Status |
| --- | --- | --- |
| Corridas finalizadas | `runs` | Fonte oficial local via `sync.js`/`RunRepository`. |
| Corrida ativa | `wayper:activeRun:v2` | Fonte canonica via `activeRunTrackingService`. |
| Checkpoint ativo legado | `wayper_active_offline_run_v1` | Compatibilidade/recovery; nao e fonte nova. |
| Territorios | `wayper_territories_v1` | Fonte local atual via `TerritoryRepository`. |
| Eventos territoriais | `wayper_territory_events_v1` | Fonte local atual. |
| Leaderboards territoriais | `wayper_territory_leaderboards_v1` | Cache/local atual para lideres locais. |
| Perfil | `wayper_profile_v3` | Cache/local do perfil e agregados. |
| Ranking | `wayper:rankingCache:v1:*` | Cache identificado; nao substitui ranking real. |
| Stories de corrida | `wayper_run_stories_v1` | Stories locais/cacheados da Home social. |
| Feed social cacheado | `wayper_activity_feed_cache_v1` | Cache normalizado da Home social. |
| Progresso/XP | `wayper_user_progress_v1` | Fonte local atual via `ProgressionRepository`. |
| Eventos de XP | `wayper_xp_events_v1` | Auditoria local/idempotencia de XP. |
| Conquistas desbloqueadas | `wayper_achievements_v1` | Fonte local atual via `AchievementRepository`. |
| Progresso de conquistas | `wayper_achievement_progress_v1` | Progresso parcial local por conquista. |
| Diagnostico/logs | `wayper-diagnostics` | Diretorio file-system com NDJSON e reports exportaveis. |
| Diagnostico/testes | `wayper:diagnosticLogs:v1` | Storage usado em ambiente de teste/fallback para logs. |
| Onboarding | `wayper:onboarding:v1:completed` | Flag local de onboarding concluido. |

Storages legados marcados:

| Storage | Motivo | Substituto |
| --- | --- | --- |
| `wayper_unsynced_runs_v2` | Fila antiga de `runService.js`. | `runs` + `sync.js`/`runSyncQueueService`. |
| `wayper_runs_cache_v2` | Cache antigo de `runService.js`. | `runs`. |
| `wayper_active_run_v1` | Estado ativo antigo. | `wayper:activeRun:v2`. |
| `zones` | Zonas antigas. | `wayper_territories_v1` apos migracao explicita. |
| `@wayper_zones` | Storage antigo de `src/storage/zonesStorage.js`. | `wayper_territories_v1` apos migracao explicita. |
| `medals` | Medalhas antigas sincronizadas por `sync.js`. | `wayper_achievements_v1` apos migracao explicita, se aprovada. |
| `@wayper:medals_awarded_v1` | Estado visual antigo do `MedalsWidget`. | Nao migrar automaticamente para conquista real. |

Regra: migracoes locais nao apagam dados legados nesta fase. Elas apenas registram metadata e, quando chamadas explicitamente, podem copiar zonas antigas para territorios atuais.

## diagnostico e logs

O diagnostico local usa resumos pequenos e export ZIP sanitizado. A fonte consolidada e `src/services/diagnostics/localDiagnosticsService.js`, com persistencia em `src/services/diagnostics/logStorageService.js`.

Campos/artefatos esperados:

| Artefato | Uso |
| --- | --- |
| `*.ndjson` em `wayper-diagnostics` | Eventos categorizados de corrida, GPS, lifecycle, storage, sync e UI. |
| `localDiagnostics-summary.json` | Resumo agregado por dominio para triagem. |
| `reports/*` | Reports especificos de GPS, storage, notificacao/background, sync, Home social, share, territorio, perfil/ranking/XP. |
| `manifest.json` | Metadata do export e ambiente. |

Regras:

- Coordenadas exatas ficam mascaradas por padrao.
- `rawPath` completo, tokens, emails completos, imagens privadas e payloads completos de terceiros nao entram no resumo padrao.
- Export local deve funcionar sem Firestore, Sentry, upload remoto ou rede.

## Cuidados

- Não salvar dados sensíveis desnecessários.
- Proteger leitura/escrita com regras do Firestore.
- Evitar documentos grandes demais para rotas muito longas.
- Considerar simplificação/compressão de rota.
- Validar se cálculo de ranking deve ficar no client ou em backend controlado.

## Modelo planejado do processamento da Expedição

**Status:** planejado; estas chaves ainda não representam storage implementado.

O schema definitivo deve evoluir a fila `wayper_run_deferred_tasks_v1`, não criar
um segundo mecanismo concorrente.

```js
expeditionProcessing = {
  runId,
  version,
  status, // pending | processing | partial | ready | failed_retryable | failed_permanent
  createdAt,
  updatedAt,
  modules: {
    metrics: {
      status,
      version,
      attempts,
      updatedAt,
      resultRef,
      errorCode,
    },
    territory: { /* mesmo envelope */ },
    progression: { /* mesmo envelope */ },
    ranking: { /* mesmo envelope */ },
    challenges: { /* mesmo envelope */ },
    rewards: { /* mesmo envelope */ },
  },
}
```

Requisitos:

- chave idempotente por `runId + module + version`;
- payload mínimo e sanitizado na fila;
- resultado persistido separado do estado transitório;
- falha de um módulo não altera a corrida finalizada;
- migração lê tarefas atuais e evita duplicação.

## Modelo planejado do Relatório da Expedição

```js
expeditionReport = {
  runId,
  version,
  overallStatus, // partial | ready
  generatedAt,
  sections: [
    {
      type, // metrics | route | territory | progression | ranking | challenge | reward | share
      status,
      version,
      updatedAt,
      dataRef,
      errorCode,
    },
  ],
}
```

O relatório referencia a corrida salva e resultados derivados. Ele não duplica a
rota canônica nem concede XP/recompensa. Os schemas Free/Plus, campanha, pagamento
e anúncio permanecem conceituais até fases próprias.

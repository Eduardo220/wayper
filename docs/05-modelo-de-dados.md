# Modelo de Dados

Modelo inicial proposto para Firestore. Deve ser ajustado conforme o código real evoluir.

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

## rankings

Representa rankings agregados.

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | string | Exemplo: `global_area_monthly_2026_05`. |
| `type` | string | `area`, `zones`, `distance`. |
| `period` | string | `global`, `weekly`, `monthly`. |
| `entries` | array | Lista resumida de usuários e pontuações. |
| `updatedAt` | timestamp | Última atualização. |

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

Storages legados marcados:

| Storage | Motivo | Substituto |
| --- | --- | --- |
| `wayper_unsynced_runs_v2` | Fila antiga de `runService.js`. | `runs` + `sync.js`/`runSyncQueueService`. |
| `wayper_runs_cache_v2` | Cache antigo de `runService.js`. | `runs`. |
| `wayper_active_run_v1` | Estado ativo antigo. | `wayper:activeRun:v2`. |
| `zones` | Zonas antigas. | `wayper_territories_v1` apos migracao explicita. |
| `@wayper_zones` | Storage antigo de `src/storage/zonesStorage.js`. | `wayper_territories_v1` apos migracao explicita. |

Regra: migracoes locais nao apagam dados legados nesta fase. Elas apenas registram metadata e, quando chamadas explicitamente, podem copiar zonas antigas para territorios atuais.

## Cuidados

- Não salvar dados sensíveis desnecessários.
- Proteger leitura/escrita com regras do Firestore.
- Evitar documentos grandes demais para rotas muito longas.
- Considerar simplificação/compressão de rota.
- Validar se cálculo de ranking deve ficar no client ou em backend controlado.

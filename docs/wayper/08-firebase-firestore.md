# Firebase e Firestore

## Status deste documento

Esta é uma proposta inicial de modelagem. Não é uma decisão definitiva.

Antes de criar, renomear ou remover coleções no Firestore, a mudança deve ser registrada em [[10-decisoes-do-projeto]] e refletida neste documento.

## Objetivo

O Firestore deve persistir:

- Usuários.
- Atividades.
- Rotas.
- Conquistas territoriais.
- Dados agregados para perfil.
- Dados preparados para rankings futuros.

O modelo deve evitar custo excessivo, principalmente em rotas com muitos pontos GPS.

## MVP mínimo recomendado

Para reduzir risco no MVP, a persistência inicial deve priorizar:

- `users` para perfil e agregados simples.
- `activities` para resumo, status e auditoria da atividade.
- Dados de rota salvos de forma controlada, simplificada ou compactada quando necessário.
- Campo ou estrutura simples para indicar território individual derivado da atividade, se a mecânica inicial exigir.

No MVP, não criar coleções dedicadas para ranking, achievements, clans ou posse competitiva de território sem decisão registrada em [[10-decisoes-do-projeto]].

## Coleção `users`

Proposta:

`users/{userId}`

Campos possíveis:

- `displayName`
- `email`
- `photoURL`
- `createdAt`
- `updatedAt`
- `xpTotal`
- `level`
- `activityCount`
- `validDistanceMeters`
- `territoryCount`
- `lastActivityAt`

Uso:

- Perfil do usuário.
- Agregados rápidos.
- Base para ranking futuro.

## Coleção `activities`

Proposta:

`activities/{activityId}`

Campos possíveis:

- `userId`
- `type`: `walk` ou `run`
- `status`: `completed`, `cancelled`, `invalid`, `suspect`
- `startedAt`
- `endedAt`
- `activeDurationSeconds`
- `pausedDurationSeconds`
- `distanceMeters`
- `validDistanceMeters`
- `xpEarned`
- `gpsQuality`
- `territoryProcessed`
- `createdAt`
- `updatedAt`

Uso:

- Histórico.
- Resumo.
- Auditoria simples.
- Recalcular agregados se necessário.

## Rotas

Proposta possível:

`activities/{activityId}/routePoints/{pointId}`

Campos possíveis:

- `lat`
- `lng`
- `accuracy`
- `timestamp`
- `speed`
- `valid`
- `segmentIndex`

Alternativa:

- Salvar rota simplificada como array ou objeto compactado em documento separado.

Alerta:

Criar um documento por ponto GPS pode ficar caro. Antes de implementar, avaliar frequência de coleta, duração média das atividades e limites do Firestore.

## Sincronização offline de atividades

Durante a corrida ativa, Firestore não é fonte de verdade. O app salva estado e pontos localmente e só tenta gravar remoto depois que a corrida é finalizada e confirmada no histórico local.

Campos locais adicionados ao registro de corrida:

- `syncStatus`: `PENDING`, `SYNCING`, `SYNCED` ou `FAILED`.
- `offlineStatus`: estado visual/local como `PENDING_SYNC`, `SYNCING`, `SYNCED` ou `SYNC_FAILED`.
- `localRunId`: identificador local usado antes/depois do envio remoto.
- `remoteRunId`: identificador remoto quando a sincronização conclui.
- `syncAttempts`.
- `lastSyncError`.
- `lastSyncedAt`.
- `schemaVersion`.

No Firestore, a corrida sincronizada continua usando `runs/{runId}`, `users/{userId}/runs/{runId}` e `activities/{activityId}`. Status locais de sincronização não devem substituir o status remoto de atividade concluída.

Diretrizes:

- Não gravar ponto a ponto no Firestore durante a corrida ativa.
- Manter rota e resumo no histórico local até sincronizar.
- Listar historico e abrir detalhes por `sync.loadLocalRunHistory()` / `sync.findLocalRunById()` antes de qualquer dependencia remota.
- Deduplicar corridas por `id`, `localRunId`, `remoteRunId`, `runId` e `legacyId`.
- Preservar `trustedPath`, `renderPath`, `rawPath`, `segments`, `syncStatus` e `offlineStatus` na copia local mesmo apos sync.
- Tentar sincronização automática quando a conexão voltar.
- Tratar escrita remota como idempotente para permitir retry.

Regra atual da fila de runs:

- A fila local parte da chave `runs` e nao de uma colecao paralela.
- `remoteRunId` e usado como id do documento quando existir.
- Sem `remoteRunId`, o app tenta localizar `runs` por `localRunId`; se nao encontrar, usa `localRunId` como id remoto deterministico.
- O payload remoto inclui `localRunId` e `remoteRunId` para dedupe futuro.
- O app escreve `runs/{remoteRunId}`, `users/{uid}/runs/{remoteRunId}` e `activities/run_{uid}_{remoteRunId}`.
- `PENDING`, `PENDING_SYNC`, `LOCAL_ONLY`, `FAILED`, `SYNC_FAILED` e `SYNCING` podem entrar na fila; `SYNCED` sem `pendingSync` nao entra.
- Falha de Firestore marca a copia local como `SYNC_FAILED`, registra `syncError`/`syncErrorType` e nao remove a corrida do historico.
- O payload remoto remove `undefined`/funcoes antes da escrita.
- Corrida livre nao envia territorio falso; corrida por zonas envia area/geometria/coords somente quando ja existem localmente.
- Arrays de rota enviados ao Firestore podem ser limitados por `ROUTE_CAP`; a copia local permanece completa e o payload remoto registra `remoteRouteLimits`.

## Camada local-first antes do Firestore

Firestore e destino remoto ou fonte remota cacheavel, nao dependencia obrigatoria para os fluxos adaptados nesta etapa.

Repositories atuais:

- `RunRepository`: le/escreve historico local por `sync.js`; Firestore so entra no sync posterior.
- `RunSyncQueueRepository`: agenda/processa fila oficial de runs por `runSyncQueueService`/`sync.js`.
- `TerritoryRepository`: le/escreve storage local atual de territorios e separa zonas legadas de territorios atuais.
- `profileStats`: consolida estatisticas locais de perfil por `RunRepository`, `TerritoryRepository`, `ProgressionRepository` e `AchievementRepository`.
- `UserProfileRepository`: retorna perfil local/cacheado quando remoto falha, mescla estatisticas locais reais e tenta Firestore/Storage como melhor esforco.
- `RankingRepository`: retorna ranking remoto quando existir, cache quando disponivel, local quando aplicavel ou estado vazio identificado; mock/demo nao pode ser apresentado como ranking real.
- `ProgressionRepository` e `AchievementRepository`: mantem XP/conquistas locais; sync remoto ainda e futuro.
- `socialHomeRepository`: compoe Home social com feed/cache/stories locais sem Firestore direto na tela.

Chamadas Firestore ainda existentes devem ficar em services/repositories ate serem desacopladas:

- sync de runs e territorios;
- perfil publico/avatar;
- ranking remoto;
- feed, amigos e grupos, ainda com partes Firestore-first;
- notificacoes;
- XP/agregados quando o service exigir remoto.
- upload/sync futuro de stories.

Regra de falha:

- Falha de Firestore nao deve apagar dado local nem impedir leitura de historico/detalhe.
- Erro remoto em perfil/ranking deve virar cache, local limitado, vazio controlado ou erro de repository identificado.
- Story local em `wayper_run_stories_v1` continua `PENDING_SYNC` ate existir publicacao remota real.
- XP/conquistas locais continuam validos mesmo sem sync remoto.
- Mocks e demos precisam carregar `source: "demo"` ou equivalente, nunca serem tratados como dado real.
- Cache de ranking precisa carregar `updatedAt`/`cachedAt`.
- Upload de avatar por Storage e melhor esforco; falha nao deve apagar avatar local/cacheado nem gravar `file://` como avatar remoto.

## Territorios antes do Firestore

A fonte local oficial de territorio atual fica fora do Firestore:

| Dado | Storage local | Acesso oficial |
| --- | --- | --- |
| Territorios atuais | `wayper_territories_v1` | `TerritoryRepository` / `territoryStorageService` |
| Eventos territoriais | `wayper_territory_events_v1` | `TerritoryRepository` / `territoryStorageService` |
| Leaderboards/cache territoriais | `wayper_territory_leaderboards_v1` | `TerritoryRepository` / services de territorio |
| Zonas legadas | `zones`, `@wayper_zones` | Somente migracao/compatibilidade explicita |

Diretrizes:

- Corrida por zonas conclui localmente mesmo offline.
- A corrida finalizada preserva `area`, `areaM2`, `zoneCoords`, `geometry`, `routeGeometry`, `territorySummary`, `territoryEvents` e `capturedCells` quando a captura local existe.
- Corrida livre nao envia nem preserva territorio falso.
- `syncTerritoriesToFirestore()` e `syncTerritoryEventsToFirestore()` sao filas separadas do sync de runs.
- Falha remota de territorio nao remove territorio local nem bloqueia historico/detalhe de corrida.
- Feed/mapa/leaderboards territoriais devem usar local/cache/vazio controlado quando Firestore falhar.

## Coleção `territoryClaims`

Proposta opcional, caso a estratégia territorial do MVP exija registro separado de conquistas:

`territoryClaims/{claimId}`

Campos possíveis:

- `userId`
- `activityId`
- `territoryId`
- `claimedAt`
- `source`
- `areaMeters`
- `status`

Uso:

- Registrar conquistas derivadas de atividades.
- Permitir histórico de território.
- Preparar métricas futuras de território.

Alerta:

Esta coleção não deve ser usada para disputa entre usuários no MVP.

## Coleção `territories`

Proposta se houver células ou zonas persistidas:

`territories/{territoryId}`

Campos possíveis:

- `type`
- `geometryRef`
- `centerLat`
- `centerLng`
- `createdAt`
- `claimCount`

Essa coleção só deve existir se a estratégia territorial exigir entidades compartilhadas. Para território individual simples, talvez não seja necessária no MVP.

## Rankings

Proposta futura:

`rankings/{rankingId}/entries/{userId}`

Campos possíveis:

- `userId`
- `xpTotal`
- `validDistanceMeters`
- `territoryCount`
- `activityCount`
- `period`
- `updatedAt`

Ranking pode ser derivado de `users` no MVP. Uma coleção dedicada só deve existir se houver necessidade real de performance, período ou ordenação específica.

No MVP, a recomendação é não criar coleção dedicada de rankings. Preparar agregados em `users` é suficiente até uma decisão humana aprovar ranking competitivo.

## Conquistas

Proposta futura:

`achievements/{achievementId}`

`users/{userId}/achievements/{achievementId}`

Uso:

- Medalhas.
- Marcos de distância.
- Marcos de território.
- Eventos futuros.

Fica fora do MVP, exceto se houver uma conquista muito simples e diretamente ligada ao onboarding.

No MVP, a recomendação é não criar coleções de conquistas até a regra de conquistas estar definida.

## Agregados

Agregados em `users` devem ser atualizados com cuidado:

- XP total.
- Nível.
- Distância válida total.
- Número de atividades.
- Território conquistado.

Ponto pendente:

- Decidir se agregados serão atualizados no app, por Cloud Functions ou em fluxo híbrido.

## Cuidados de custo

- Evitar escrita excessiva de pontos GPS.
- Evitar leituras grandes para montar histórico simples.
- Usar paginação no histórico.
- Separar dados de resumo de dados pesados de rota.
- Não carregar rotas completas em telas que só precisam de lista.

## Documentos relacionados

- [[03-mecanica-territorios]]
- [[04-regras-corrida]]
- [[05-gps-e-validacao]]
- [[06-xp-nivel-ranking]]
- [[10-decisoes-do-projeto]]


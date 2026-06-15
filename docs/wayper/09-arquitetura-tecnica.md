# Arquitetura técnica

## Stack provável

A Wayper é um app mobile em React Native com Expo.

Componentes principais:

- React Native para interface mobile.
- Expo para desenvolvimento, permissões e APIs nativas.
- Firebase Authentication para login.
- Firestore para persistência.
- `expo-location` para localização.
- Biblioteca de mapas para renderização do mapa e rotas.
- Turf.js ou biblioteca geográfica semelhante para cálculos de distância, linhas, polígonos, buffers ou interseções.

## Princípios técnicos

- Separar regra de negócio de componentes visuais.
- Não acoplar Firestore diretamente às telas quando houver lógica reutilizável.
- Tratar GPS como domínio próprio.
- Centralizar cálculos de território em services ou módulos específicos.
- Manter MVP simples e testável manualmente.
- Documentar qualquer mudança relevante antes de ampliar a mecânica.

## Separação sugerida

### `screens`

Responsável por telas completas:

- Mapa.
- Atividade ativa.
- Resumo.
- Perfil.
- Histórico.
- Login e cadastro.

### `components`

Responsável por peças reutilizáveis:

- Botões de ação.
- Cartões de resumo.
- Indicadores de GPS.
- Componentes de mapa.
- Listas de atividade.

### `hooks`

Responsável por estado e integração com ciclo de vida:

- Hook de localização.
- Hook de atividade ativa.
- Hook de autenticação.
- Hook de dados do usuário.
- Hook de histórico.

### `services`

Responsável por regras e integrações:

- Serviço de atividades.
- Serviço de rotas.
- Serviço de território.
- Serviço de XP.
- Serviço de ranking.
- Serviço de Firestore.
- Serviço de corrida offline (`runOfflineStorageService`) para persistir a atividade ativa e recuperar corridas interrompidas.

### `config`

Responsável por configuração:

- Firebase.
- Variáveis de ambiente.
- Flags de feature.

## GPS

O módulo de GPS deve:

- Solicitar permissões.
- Iniciar e parar coleta.
- Diferenciar primeiro plano e segundo plano.
- Expor precisão e status.
- Filtrar ou marcar pontos inválidos.
- Evitar que telas precisem conhecer detalhes de validação.

Regras de GPS estão em [[05-gps-e-validacao]].

## Mapas

O mapa deve:

- Mostrar posição atual.
- Mostrar rota ativa.
- Mostrar rota finalizada.
- Mostrar território conquistado quando disponível.
- Evitar renderizar dados pesados sem simplificação.

Performance de mapa deve ser acompanhada desde o MVP.

## Território

A lógica de território deve ficar isolada para permitir troca de estratégia.

Possíveis responsabilidades:

- Converter rota válida em área.
- Identificar território novo.
- Calcular área ou células.
- Gerar dados persistíveis.
- Preparar renderização.

Regras de território estão em [[03-mecanica-territorios]].

## Firestore

O acesso ao Firestore deve:

- Usar funções claras por caso de uso.
- Separar resumo de atividade dos dados pesados de rota.
- Evitar consultas caras em telas frequentes.
- Facilitar paginação.
- Manter agregados consistentes.

Modelagem proposta em [[08-firebase-firestore]].

## Corrida offline-first

A arquitetura da corrida ativa segue esta separação:

- `MapScreen` controla interação, GPS em primeiro/segundo plano, timer e renderização da rota.
- `runTracking` filtra pontos, calcula distância, segmentos e qualidade.
- `runOfflineStorageService` persiste a corrida ativa localmente com pontos aceitos, segmentos, duração, distância e status.
- `sync.js` salva a corrida finalizada no histórico local e sincroniza com Firestore por fila, status e retry.
- Serviços de território podem persistir localmente e deixar envio remoto para a sincronização posterior.

Regra arquitetural:

- Firestore não deve ser chamado para iniciar, pausar, retomar, atualizar ponto, calcular métricas ou finalizar uma corrida ativa.
- Firestore só deve receber dados depois que a corrida estiver salva localmente.
- Se AsyncStorage se tornar insuficiente para atividades longas, a camada `runOfflineStorageService` deve migrar para SQLite/Expo SQLite sem mudar a interface usada pela tela.

### Fonte de verdade consolidada da corrida ativa

Desde 2026-06-04, a fonte de verdade pratica da corrida ativa e o snapshot canonico `wayper:activeRun:v2`, mantido por `activeRunTrackingService` e modelado por `activeRunState`.

Papel de cada camada:

- `activeRunTrackingService` / `activeRunState`: estado ativo canonico, lifecycle start/pause/resume/finish, path confiavel, rawPath, renderPath, segmentos, distancia, duracao e pace.
- `trackingPathService`: filtro de GPS, criacao de segmentos, distancia, render path e qualidade da rota.
- `runAutoSaveService`: escuta snapshots canonicos e gera checkpoint local de compatibilidade.
- `runOfflineStorageService`: checkpoint legado/compatibilidade em `wayper_active_offline_run_v1` e rascunho final caso o app feche entre finish e save local.
- `runRecoveryService`: unica camada que decide entre snapshot canonico e legado, migra legado vivo para o canonico e limpa os dois storages depois que a corrida finalizada entra no historico/fila.
- `runSyncQueueService` / `sync.js`: historico local, fila pendente e sincronizacao posterior com Firestore.

Regra de conflito entre `wayper:activeRun:v2` e `wayper_active_offline_run_v1`:

1. Estados invalidos, corrompidos, de outro usuario ou com schema incompativel sao descartados.
2. Se o mesmo `runId/localRunId` aparece como finalizado e vivo, o estado finalizado vence para impedir que uma corrida encerrada volte como ativa.
3. Entre estados vivos, vence o checkpoint mais recente (`lastUpdatedAt`, `checkpointAt` ou `updatedAt`).
4. Em empate, vence o payload mais completo: possui `localRunId`, path, rawPath, segments, duracao/distancia consistentes.
5. Persistindo empate, vence o snapshot canonico.
6. Legado vivo nunca e aplicado diretamente na tela; antes ele e convertido para snapshot canonico.

Fluxo consolidado:

`start -> snapshot canonico -> checkpoint legado -> pause/resume canonicos -> AppState/background checkpoint -> recovery via runRecoveryService -> finish canonico -> rascunho final legado -> saveLocalRun/enqueue -> limpeza dos storages ativos -> sync posterior`.

### Politica de auto-save e hardening

Desde 2026-06-04, `runAutoSaveService` tambem protege a corrida ativa contra quedas entre eventos de GPS:

- Checkpoints sao disparados por eventos canonicos de `activeRunTrackingService`: start, pause, resume e snapshot final.
- Enquanto houver corrida ativa, existe checkpoint periodico leve, por padrao a cada 10 segundos.
- `MapScreen` forca checkpoint ao entrar em `background` ou `inactive`, antes de finalizar a corrida e quando falhas recuperaveis de localizacao aparecem.
- Falhas repetidas de localizacao usam throttle para evitar escrita excessiva no AsyncStorage.
- Todo checkpoint carrega `checkpointAtMs`; `runOfflineStorageService` ignora escrita viva mais antiga do mesmo `localRunId`.
- Estado `FINISHING` e tratado como finalizado para recovery, nunca como corrida viva.

Fluxo reforcado:

`start -> checkpoint imediato -> checkpoints por snapshot/periodico -> pause checkpoint -> resume checkpoint -> AppState checkpoint -> recovery consolidado -> before_finish checkpoint -> finish canonico -> rascunho final -> saveLocalRun pending sync -> limpeza ativa -> sync idempotente`.

### Notificacao persistente Android da corrida ativa

Desde 2026-06-05, a corrida ativa usa uma notificacao persistente Android baseada no modulo nativo `WayperRunNotificationAndroid`, coordenada por `runNotificationService`.

Papel de cada camada:

- `runNotificationService`: cria payload da notificacao a partir do snapshot canonico, configura canal Android, inicia/atualiza/remove a notificacao, coordena timer leve e trata acoes de pausa/retomada.
- `RunNotificationForegroundService`: foreground service Android com `foregroundServiceType="location"`, notificacao ongoing, botao contextual e deep link `wayper://run/active`.
- `RunNotificationActionReceiver` / `RunNotificationActionService` / headless task `WayperRunNotificationAction`: recebem a acao nativa e chamam os mesmos services oficiais da corrida.
- `activeRunTrackingService`: continua sendo a unica fonte de verdade da corrida ativa; a notificacao nunca cria uma corrida nova.
- `runAutoSaveService`: recebe checkpoint forcado depois de acao de pausar/retomar pela notificacao.

Comportamento esperado:

- Ao iniciar ou recuperar uma corrida `RUNNING`, a notificacao mostra `Correndo`, tempo, distancia e acao `Pausar`.
- Ao pausar, a notificacao mostra `Pausada`, preserva tempo/distancia e troca a acao para `Retomar`.
- Ao retomar, a notificacao volta para `Correndo` e mantem os segmentos existentes.
- Ao finalizar/cancelar/limpar o snapshot ativo, a notificacao e removida para evitar notificacao orfa.
- Toque no corpo da notificacao reabre a tela de corrida ativa por deep link, sem empilhar nova rota.
- Updates JS para o native module sao limitados por throttle; o foreground service continua atualizando visualmente o tempo enquanto a corrida esta rodando.

Permissoes envolvidas:

- Android: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS` e `WAKE_LOCK`.
- Se `POST_NOTIFICATIONS` for negada, a corrida local-first continua funcionando, mas a experiencia de background fica limitada e deve ser comunicada ao usuario.
- Se background location for negada, o app nao deve prometer coleta confiavel com tela bloqueada.

Decisao de UX:

- Finalizar pela notificacao nao foi implementado nesta etapa porque encerramento exige confirmacao/resumo. A notificacao oferece abrir o app, pausar e retomar; finalizar permanece dentro da UI principal.

Riscos pendentes:

- Validar em dispositivo real que background location e tela bloqueada continuam entregando pontos suficientes.
- Validar a notificacao em Expo Dev Client Android e build release Android, pois foreground service, permissao de notificacao e restricoes de bateria variam por build/aparelho.
- Medir AsyncStorage em corridas longas; migrar a interface de checkpoint para SQLite somente se houver gargalo real.
- Garantir que telas fora de corrida ativa continuem tratando Firestore como sync posterior, nao dependencia obrigatoria.

### GPS, path e renderizacao

Desde 2026-06-05, a logica oficial de coleta tratada, validacao, segmentacao, distancia e render path fica em `src/services/tracking`.

Responsabilidades:

- `trackingFilters`: normaliza pontos de foreground/background/recovery, valida coordenada, timestamp, accuracy, duplicidade, velocidade, aceleracao, jitter e gaps.
- `trackingPathService`: mantem a sessao incremental, `rawPath`, `trustedPath`, `renderPath`, `segments`, distancia e contadores de qualidade.
- `trackingRenderPath` / `trackingSmoothing`: preparam a rota visual sem alterar distancia nem `trustedPath`.
- `activeRunTrackingService`: alimenta a sessao canonica, ordena lotes de background por timestamp e ignora pontos em estados que nao aceitam tracking.
- `trackSegments` / `trackGeojson`: sanitizam segmentos e produzem `LineString` ou `MultiLineString` para mapa, historico e replay.
- `WayperMapLibre`: renderiza o GeoJSON recebido; nao deve decidir filtros de GPS nem recomputar distancia.

Campos oficiais:

- `rawPath` e diagnostico, podendo conter pontos normalizados que nao entraram nas metricas.
- `trustedPath` e a fonte de distancia, pace, XP/territorio e sync.
- `renderPath` e visual; simplificacao/suavizacao ficam aqui.
- `segments` preserva pausas e gaps tecnicos. Corrida livre e corrida por zonas devem usar a mesma base de segmentos.

Regra arquitetural:

- Pontos brutos nao podem inflar distancia.
- Suavizacao visual nao pode alterar metricas.
- Background e foreground passam pelo mesmo pipeline.
- Recovery deve hidratar `rawPath`, `trustedPath`, `renderPath` e `segments` sem recalcular uma rota paralela.
- Firestore so recebe corrida depois do save local/fila de sync.

### Historico local-first de corridas finalizadas

Desde 2026-06-05, o historico oficial de corridas finalizadas tambem e local-first.

Fonte oficial:

- Storage: chave `runs` no AsyncStorage.
- Escrita: `sync.saveLocalRun()`.
- Listagem: `sync.loadLocalRunHistory()` ou `sync.loadLocalRuns()`.
- Detalhe: `sync.findLocalRunById()`.
- Sync remoto: `syncRunsToFirestore()` atualiza a mesma copia local, sem criar storage paralelo.

Campos minimos esperados por corrida finalizada:

- `id`, `localRunId`, `remoteRunId` opcional e `userId`.
- `mode` (`free` ou `zones`), `startedAt`, `finishedAt`/`endedAt`, `date`, `createdAt`, `updatedAt`.
- `distance`, `distanceMeters`, `duration`, `durationSeconds`, `avgPace`, `avgSpeed`, `maxSpeed`.
- `syncStatus`, `offlineStatus`, `pendingSync`, `synced`, `lastSyncError`, `lastSyncedAt`.
- `trustedPath`, `renderPath`, `rawPath`, `segments` e `routeSegments`.
- Campos territoriais quando existirem: `area`, `areaM2`, `zoneCoords`, `zoneId`, `geometry`, `territorySummary`.

Regra de deduplicacao:

- Se dois registros compartilham `id`, `localRunId`, `remoteRunId`, `runId` ou `legacyId`, representam a mesma corrida.
- A versao final preserva a identidade local estavel, o `remoteRunId` quando existir, a rota mais completa e o status de sync mais recente.
- `SYNCED`, `PENDING`, `FAILED`, `SYNCING`, `PENDING_SYNC`, `SYNC_FAILED` e `LOCAL_ONLY` continuam visiveis no historico.
- Estados vivos (`RUNNING`, `PAUSED`, `RECOVERING`, `FINISHING`) nao aparecem como finalizados.

Uso nas telas:

- `CorridasScreen` lista a fonte local normalizada e usa `renderPath`/`segments` para preview.
- `RunDetailScreen` abre por `localRunId`, `remoteRunId`, `id` ou id legado e prefere a copia local.
- Metricas exibidas usam a distancia/duracao salvas; a rota visual usa `renderPath` com fallback para `trustedPath/path`.
- Corrida por zonas preserva resumo territorial quando existir; corrida livre nao inventa area conquistada.

Limite atual:

- A lista ainda usa AsyncStorage. O risco principal e volume de rota em historicos longos; migrar para SQLite/Expo SQLite se parse/carregamento de JSON ficar perceptivelmente pesado.

### Fila local de sync de corridas finalizadas

Desde 2026-06-06, a fila de sincronizacao remota de corridas finalizadas usa a mesma fonte local oficial do historico:

- Fonte local: `sync.loadLocalRunHistory()` / `sync.loadLocalRuns()` lendo a chave `runs`.
- Escrita local: `sync.saveLocalRun()`, com dedupe por `id`, `localRunId`, `remoteRunId`, `runId` e `legacyId`.
- Entrada na fila: `runSyncQueueService.enqueueFinishedRun()` ou `sync.saveLocalRun()` com status pendente.
- Processamento remoto: `sync.syncRunsToFirestore()`.

Status consolidados:

- `PENDING`, `PENDING_SYNC` e `LOCAL_ONLY` entram como pendentes.
- `FAILED` e `SYNC_FAILED` entram como falha recuperavel, salvo quando o erro local marca `syncErrorRecoverable=false`.
- `SYNCING` e tratado como retomavel depois de reabrir o app.
- `SYNCED` com `pendingSync=false` nao entra na fila.
- Status ausente em corrida sem `remoteRunId` vira pendente seguro; status ausente com `remoteRunId` e sem erro vira sincronizado.

Identidade e idempotencia:

- `localRunId` e a chave local principal e sempre vai para o documento remoto.
- `remoteRunId` e a chave remota quando ja existir.
- Se nao houver `remoteRunId`, o app tenta localizar uma corrida remota por `localRunId`.
- Se nao encontrar remoto, o documento novo usa `localRunId` como id remoto deterministico.
- `id`, `runId` e `legacyId` ficam como fallback de dedupe local, nao como preferencia remota.

Fluxo operacional:

1. Checar NetInfo; offline nao chama Firestore.
2. Selecionar corridas finalizadas pendentes/falhas recuperaveis.
3. Marcar item como `SYNCING` localmente com `lastSyncAttemptAt` e incremento de `syncAttempts`/`retryCount`.
4. Sanitizar payload remoto e remover `undefined`, funcoes e campos territoriais falsos.
5. Gravar `runs/{remoteRunId}`, `users/{uid}/runs/{remoteRunId}` e `activities/{activityId}` por item.
6. Em sucesso, salvar `remoteRunId`, `SYNCED`, `syncedAt` e limpar `syncError`.
7. Se a copia local mudou durante o envio, preservar `remoteRunId`, mas voltar para `PENDING_SYNC`.
8. Em falha, salvar `SYNC_FAILED`, `syncError`, `syncErrorType` e manter a corrida visivel.

Conectividade e retry:

- `startAutoSync()` agenda tentativa inicial, tentativa ao voltar internet e tentativa ao voltar para AppState `active`.
- Mudancas de rede/AppState usam debounce para evitar rajadas.
- Um lock em memoria ignora sync concorrente; retry manual e automatico compartilham o mesmo worker.
- Falhas recuperaveis agendam retry com backoff; falhas de validacao/permissao ficam registradas sem apagar local.

Payload remoto:

- Preserva `distance`, `duration`, `pace`, `startedAt`, `finishedAt`, `mode`, `localRunId`, `remoteRunId`, `trustedPath`, `renderPath`, `rawPath`, `segments` e `schemaVersion`.
- Corrida por zonas envia `area`, `areaM2`, `zoneCoords`, `geometry`, `territorySummary` e eventos territoriais existentes.
- Corrida livre envia `mode=free` e nao inventa `area`, `geometry`, `zoneCoords` ou `zoneCount`.
- Para reduzir risco de limite de documento Firestore, arrays de rota enviados ao remoto seguem `ROUTE_CAP`; a copia local fica intacta e o payload registra `remoteRouteLimits`.

Relacao com territorios:

- Sync de runs nao recalcula territorio e nao cria captura nova.
- `syncTerritoriesToFirestore()` e `syncTerritoryEventsToFirestore()` continuam filas separadas.
- Falha de territorio nao apaga corrida nem remove a corrida do historico.

### Repositories local-first incrementais

Desde 2026-06-06, a camada de acesso a dados passa a ter facades finas para reduzir Firestore direto nas telas sem trocar os services oficiais:

- `src/repositories/runRepository.js`: encapsula historico local de runs por `sync.js`. A chave `runs` continua oficial.
- `src/repositories/runSyncQueueRepository.js`: encapsula enfileiramento/retry/auto sync por `runSyncQueueService` e `sync.js`, sem storage proprio.
- `src/repositories/territoryRepository.js`: encapsula territorios/eventos/leaderboards locais atuais; `zones` e `@wayper_zones` sao legados explicitos.
- `src/repositories/profileStats.js`: consolida estatisticas locais de perfil/ranking a partir de runs, territorios, XP e conquistas reais.
- `src/repositories/userProfileRepository.js`: encapsula perfil local/cacheado por `profileService`, mescla `profileStats` e trata Firestore/Storage como melhor esforco.
- `src/repositories/rankingRepository.js`: encapsula ranking remoto/cache/local e identifica demo/vazio para nao mascarar ausencia de dado real.
- `src/repositories/localMetadataRepository.js` e `src/services/storage/storageMigrationService.js`: registram schemaVersion, migrations executadas e storages legados sem apagar dados.

Territorio local-first:

- `TerritoryRepository` normaliza `localId`, `remoteId`, `runLocalId`, `runRemoteId`, `syncStatus`, `offlineStatus` e `schemaVersion` sem criar storage paralelo.
- `MapScreen` deve preferir `TerritoryRepository.list({ status: "active" })` para cache local e so usar Firestore por services remotos como melhor esforco.
- `DashboardScreen` e feed/home devem usar territorios atuais locais, nao `sync.loadLocalZones()`.
- A captura territorial continua em `territoryCaptureService`; repository nao recalcula geometria nem reimplementa antifraude.
- `zones` e `@wayper_zones` so aparecem em `listLegacyZones()` ou migracao explicita.

Perfil/ranking local-first:

- `ProfileScreen` deve consumir `UserProfileRepository`; Firestore direto fica fora da tela.
- Estatisticas do perfil contam corridas finalizadas locais, inclusive pendentes/falhas de sync, mas ignoram corrida ativa e `FINISHING`.
- Dedupe de estatistica e ranking local usa `localRunId`, `remoteRunId`, `id`, `runId` e `legacyId`.
- `RankingScreen` deve consumir `RankingRepository` e respeitar `source`: `remote`, `cache`, `local`, `empty` ou `demo`.
- Ranking local limitado nao inventa usuarios; demo exige opt-in/dev e nunca mascara falha remota.

Regra de evolucao:

- Tela nova ou alterada deve depender de repository/service quando houver regra de dado, nao de Firestore direto.
- Repository deve chamar service existente quando ele ja for a fonte oficial; nao criar storage paralelo para melhorar aparencia da arquitetura.
- Corrida ativa, GPS/path, notificacao/background e sync de runs nao devem ser reimplementados por repositories.
- Firestore continua permitido dentro de services/repositories, tratado como remoto posterior ou melhor esforco.

SQLite:

- Nao foi adicionado nesta etapa. A decisao segue pendente de medicao de volume real de rotas, custo de parse do historico e impacto em Expo Dev Client/release Android.

## Turf.js ou biblioteca geográfica

Uma biblioteca geográfica pode ser usada para:

- Calcular distância.
- Simplificar rotas.
- Criar buffer ao redor de linhas.
- Calcular interseções.
- Trabalhar com polígonos.

Antes de adicionar ou ampliar dependência geográfica, avaliar:

- Tamanho no bundle.
- Performance no dispositivo.
- Complexidade da API.
- Necessidade real para o MVP.

## Pontos pendentes

- Biblioteca final de mapas.
- Estratégia final de território.
- Onde calcular território: app, backend ou híbrido.
- Estratégia de localização em segundo plano.
- Estratégia de compactação de rota.
- Uso de Cloud Functions para agregados e ranking.

## Documentos relacionados

- [[02-mvp]]
- [[05-gps-e-validacao]]
- [[08-firebase-firestore]]
- [[10-decisoes-do-projeto]]


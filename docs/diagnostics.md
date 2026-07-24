# Diagnostico e Logs do Wayper

O Wayper possui um sistema centralizado de logs para investigar falhas em corrida ativa, GPS, background, recovery, storage local, mapa, notificacoes, permissoes, UI e sync.

## Logger central

Use `src/utils/logger.js`.

```js
import logger from "../utils/logger.js";

logger.info("RUN_RECOVERY", "Loaded active run from storage", {
  runId,
  status,
  segmentsCount,
  trustedPointsCount,
  distance,
});
```

Nao use `console.log` direto em fluxos novos. Se precisar registrar algo, passe pelo logger ou pelo `runDiagnosticsService`.

## Niveis

- `debug`: detalhe temporario ou frequente, como ponto GPS recebido. Fica ativo em dev.
- `info`: evento esperado e util para timeline, como corrida iniciada ou watcher iniciado.
- `warn`: comportamento anormal recuperavel, como permissao negada, ponto rejeitado, checkpoint parcial ignorado, distancia regressiva bloqueada.
- `error`: falha de operacao, como erro de storage, sync ou recovery.
- `fatal`: erro global ou falha que pode derrubar a experiencia.

## Categorias

Categorias disponiveis:

`RUN_SESSION`, `RUN_TRACKING`, `RUN_RECOVERY`, `LOCATION`, `BACKGROUND`, `STORAGE`, `MAP`, `NOTIFICATION`, `SYNC`, `PERMISSION`, `SHARE`, `STORY`, `TERRITORY`, `PROFILE`, `RANKING`, `XP`, `UI`, `UI_ACTION`, `PERFORMANCE`, `APP_STATE`, `FIREBASE`, `UNKNOWN`.

Para eventos de corrida, prefira:

```js
import { recordRunEvent, recordRunSnapshotEvent } from "../services/diagnostics/runDiagnosticsService.js";

recordRunEvent("PAUSE_PRESSED", { runId, status });
recordRunSnapshotEvent("RECOVERY_COMPLETED", snapshot);
```

## Privacidade

O logger sanitiza contexto antes de console/persistencia:

- remove senha, tokens, refresh tokens, secrets e credenciais;
- mascara emails;
- limita arrays grandes;
- em producao mascara coordenadas por precisao reduzida.

Nao envie payload bruto de usuario, Firebase Auth ou documentos completos do Firestore.

## Tela de Diagnostico

Em builds dev e prod, abra:

`Menu lateral > Configuracoes > Diagnostico`

A tela mostra:

- Corrida ativa: existencia, status, `runId`, `localRunId`, inicio, tempo, distancia, contadores de `rawPath`/`trustedPath`/`renderPath`, segmentos, route chunks, checkpoint, recovery, auto-save, watcher e notificacao.
- GPS/tracking: pontos recebidos, aceitos, descartados, motivos de descarte, accuracy/speed recentes, gaps e ultimo erro de localizacao.
- Permissoes: foreground location, background location, notificacoes, midia/galeria, onboarding concluido e acao para abrir configuracoes.
- Storage local: contagem de runs, snapshot ativo canonico, snapshot legado, territorios, eventos territoriais, stories, feed cache, XP, conquistas, perfil, ranking e saude dos logs.
- Sync: runs `PENDING_SYNC`, `SYNC_FAILED`, `SYNCING`, `SYNCED`, fila pendente, ultimo attempt, lock ativo, online/offline e ultimo erro.
- Notificacao/background: foreground service, notification id/status, actions registradas, background task, foreground watcher, AppState e eventos recentes de lifecycle.
- Home social/stories/feed: stories locais, pending/failed story sync, feed cache, source atual, demo habilitado ou nao e ultimo erro remoto.
- Compartilhamento: ultimo export de imagem/PNG, ultimo erro, permissao de midia, story criado via share e arquivos temporarios rastreados.
- Territorio: territorios, eventos, leaderboards cache, zonas legadas, area total, pending sync, ultima captura e ultimo erro.
- Perfil/ranking/XP: profile source, XP, level, conquistas, ranking source e cache atualizado.
- Sentry: status, ambiente, DSN, release, dist e envio de evento de teste quando habilitado.
- Ultimos logs com filtros por nivel e categoria.

A fonte consolidada e `src/services/diagnostics/localDiagnosticsService.js`. Ela agrega apenas resumos, contadores e amostras pequenas por repository/service existente. Firestore e sempre melhor esforco: o diagnostico local nao precisa de rede, Firebase real, GPS real ou MapLibre real para montar o resumo.

## Diagnostico de emergencia na corrida

Durante uma corrida ativa, a tela `MapScreen` deve expor um atalho direto de diagnostico no card `Wayper live`, sem depender de drawer, menu lateral ou `Configuracoes`. O atalho fica disponivel em `RUNNING` e `PAUSED`, gera um artefato JSON leve de corrida ativa e abre o share sheet nativo. Ele nao deve montar o ZIP completo dentro da `MapScreen`, porque ler NDJSON, montar bundle e gerar ZIP pode disputar event loop/storage com GPS, finalizacao e UI.

O ZIP completo continua disponivel em `Configuracoes > Diagnostico` (`Exportar corrida ativa`, `Exportar ultima corrida` e `Exportar logs recentes`). Durante a corrida, o JSON leve deve marcar `light: true` e `fullExportDeferred: true`, trazendo runtime resumido, storage health, contadores, contexto de emergencia e snapshots sanitizados suficientes para destravar a investigacao inicial. A corrida nao deve ser pausada, finalizada ou bloqueada para exportar esse artefato.

O mesmo atalho registra eventos:

- `RUN_EMERGENCY_DIAGNOSTICS_EXPORT_STARTED`;
- `RUN_EMERGENCY_DIAGNOSTICS_EXPORT_SUCCESS`;
- `RUN_EMERGENCY_DIAGNOSTICS_EXPORT_FAILED`;
- `RUN_DIAGNOSTIC_EXPORT_TIMEOUT`;
- `RUN_DIAGNOSTIC_SHARE_TIMEOUT_OR_FAILED`;
- `RUN_DIAGNOSTIC_EXPORT_CANCELLED_FOR_FINISH`;
- `RUN_EMERGENCY_DIAGNOSTICS_LONG_PRESS`.

Se o usuario finalizar a corrida enquanto o diagnostico leve esta em andamento, a finalizacao tem prioridade. A MapScreen deve cancelar/liberar o estado visual do export, registrar `RUN_DIAGNOSTIC_EXPORT_CANCELLED_FOR_FINISH` e seguir para o save local. Se o share sheet falhar ou demorar demais, o arquivo leve permanece salvo localmente e o ZIP completo pode ser exportado depois pela tela de Diagnostico.

Enquanto a corrida esta ativa, `MapScreen` tambem grava snapshots leves `EMERGENCY_RUN_DIAGNOSTIC_SNAPSHOT` em eventos criticos e a cada ~30s. O snapshot deve conter status, elapsed/distance, `lastUiTickAt`, `lastLocationReceivedAt`, `lastLocationAcceptedAt`, `lastRenderPathUpdatedAt`, watcher, AppState, notificacao, timer, counts de path/segments, motivos agregados de descarte, ultimo erro e contadores de stall. Ele nao deve salvar `rawPath` completo nem coordenadas exatas por padrao.

Tentativas de abrir o drawer pelo header devem registrar `RUN_DRAWER_OPEN_REQUESTED`, `RUN_DRAWER_OPENED` e, quando nao houver confirmacao em tempo util, `RUN_DRAWER_OPEN_TIMEOUT`. Isso existe para separar falha de toque/drawer de travamento de GPS, timer ou render do mapa.

A notificacao Android ainda nao possui acao de export de diagnostico. O modulo nativo atual usa uma acao contextual unica para Pausar/Retomar; adicionar uma segunda acao deve ser feito em uma etapa propria, com validacao fisica, para nao quebrar o contrato critico de controle da corrida.

## Acoes seguras

A tela oferece acoes operacionais protegidas:

- `Copiar resumo tecnico`: copia um texto curto com corrida ativa, GPS, permissoes, storage, sync, social, territorio e perfil.
- `Exportar ultima corrida`, `Exportar corrida ativa` e `Exportar logs recentes`: geram ZIP local.
- `Forcar flush de logs`: grava o buffer de logs antes de exportar.
- `Verificar permissoes`: atualiza o resumo normalizado.
- `Abrir configuracoes do app`: usa a facade `permissions.openAppSettings`.
- `Tentar sync pendente`: chama `RunSyncQueueRepository.retry()`; Firestore continua melhor esforco e a copia local e preservada.
- `Enviar ultima corrida`: opcional, somente quando backend de upload estiver configurado.
- `Limpar logs antigos`: exige confirmacao e remove apenas pacotes de logs antigos, mantendo corridas e dados locais.

O debug nao oferece limpar runs/corridas por padrao. Qualquer acao destrutiva futura deve ficar atras de modo dev claro e confirmacao explicita.

## Armazenamento local

Os logs de alta frequencia nao usam AsyncStorage. Eles sao gravados em arquivos NDJSON com buffer em:

`FileSystem.documentDirectory/wayper-diagnostics/`

Cada corrida recebe um diretorio proprio em `runs/<runId>/`. Os arquivos atuais sao rotacionados ao atingir 4 MB e as corridas recentes sao mantidas para exportacao posterior.

Arquivos:

- `events.ndjson`: timeline completa;
- `gps.ndjson`: pontos raw e decisoes accepted/rejected;
- `storage.ndjson`: checkpoints, chunks, flushes e falhas;
- `lifecycle.ndjson`: app state, background task, watcher e recovery;
- `notification.ndjson`: estado e acoes da notificacao.

## Exportacao

Na tela `Diagnostico`:

- `Exportar ultima corrida`;
- `Exportar corrida ativa`;
- `Exportar logs recentes`;
- `Enviar ultima corrida`;
- `Limpar logs antigos`.

Cada exportacao gera um ZIP compartilhavel pelo Android. O ZIP inclui:

- `wayper-last-run-diagnostics.json`;
- os cinco arquivos NDJSON;
- `gpsFilterReport.json`;
- `routeChunks-metadata.json`;
- `activeRun-snapshot-light.json`;
- `storageHealth.json`;
- `nativeNotificationState.json`;
- `backgroundTaskStatus.json`;
- `foregroundWatcherStatus.json`;
- `runtime-state.json`;
- `emergencyRunDiagnostics.json`;
- `uiInteractionEvents.json`;
- `localDiagnostics-summary.json`;
- `reports/app-build-device-metadata.json`;
- `reports/gps-report.json`;
- `reports/sync-report.json`;
- `reports/permissions-report.json`;
- `reports/storage-report.json`;
- `reports/notification-background-report.json`;
- `reports/share-report.json`;
- `reports/stories-feed-report.json`;
- `reports/territory-report.json`;
- `reports/profile-ranking-xp-report.json`;
- `manifest.json`.

Coordenadas exatas ficam desligadas por padrao. O opt-in deve ser ativado explicitamente na tela antes de uma corrida de teste. Sem opt-in, coordenadas sao mascaradas.

O resumo/export nao inclui `rawPath` completo, tokens, headers de auth, emails completos, imagens privadas, payload completo de feed de terceiros ou coordenadas precisas por padrao. O opt-in de coordenadas exatas deve ser usado somente em corrida controlada, com ciencia de que o ZIP pode revelar trajeto preciso.

Se uma secao falhar, o export continua e marca a secao com `ok: false` e erro sanitizado. Isso evita que uma falha em feed remoto, ranking, Sentry ou permissao derrube a coleta de evidencia local.

Tambem e possivel usar:

```js
import { exportDiagnosticsBundle } from "../services/diagnostics/runDiagnosticsService.js";

const bundle = await exportDiagnosticsBundle();
```

## Upload opcional

O export local sempre funciona. O envio remoto so e habilitado quando:

`EXPO_PUBLIC_WAYPER_DIAGNOSTICS_UPLOAD_ENABLED=true`

Quando habilitado, o ZIP vai para Firebase Storage e o Firestore recebe somente metadata e o resumo `gpsFilterReport`. O conteudo NDJSON nao e salvo em documento Firestore.

## Modo producao

Diagnostico fica acessivel tambem em producao por `Menu lateral > Configuracoes > Diagnostico`, porque bugs reais de corrida/background/share/sync normalmente acontecem em aparelho fisico e release. Em producao:

- logs respeitam o nivel configurado e debug/info sao limitados;
- coordenadas exatas continuam desligadas por padrao;
- Sentry recebe apenas erros/fatal e contexto sanitizado;
- export local funciona sem Sentry, Firestore ou upload remoto;
- acoes destrutivas exigem confirmacao e nao limpam corridas.

## Checklist para bug real

- Abrir Diagnostico sem corrida ativa e confirmar storage/permissoes.
- Iniciar corrida e abrir Diagnostico para conferir status, `localRunId`, watcher, notification e contadores de path.
- Durante corrida ativa, usar o atalho `Diagnostico` no card `Wayper live` e confirmar que o JSON leve abre no share sheet sem pausar/finalizar a corrida.
- Durante corrida ativa, iniciar o export leve e tocar em `Finalizar`; confirmar que a finalizacao local vence, a corrida salva, e o export nao deixa a UI presa em `EXPORTANDO`.
- Bloquear tela, voltar pelo app/notificacao e conferir background/lifecycle.
- Gerar pontos GPS e comparar raw/accepted/rejected/gaps.
- Pausar/retomar e conferir segmentos.
- Finalizar offline e conferir `PENDING_SYNC`.
- Criar story local e conferir pending story sync.
- Compartilhar imagem/PNG e conferir ultimo export em `Compartilhamento`.
- Negar permissoes e conferir resumo normalizado.
- Exportar ZIP pela tela `Diagnostico`, abrir `localDiagnostics-summary.json` e validar que coordenadas estao mascaradas.
- Abrir `emergencyRunDiagnostics.json` e `uiInteractionEvents.json` e validar `lastUiTickAt`, watcher, timer, drawer attempts, stalls e counts de path.
- Repetir em build dev Android e, quando possivel, em release.

## APK prod sem adb

1. Instale o APK prod.
2. Antes da corrida, abra `Configuracoes > Diagnostico` e confirme `log backend: file-system`.
3. Deixe `Coordenadas exatas` desligado, salvo em uma corrida controlada.
4. Corra normalmente, inclusive com tela bloqueada.
5. Depois, abra `Configuracoes > Diagnostico`.
6. Use `Exportar ultima corrida` e compartilhe o ZIP por Drive, email ou outro app.

No `gpsFilterReport.json`, compare:

- `rawPoints`;
- `acceptedByCurrentFilter`;
- `rejectedByCurrentFilter`;
- `acceptedByRelaxedFilter`;
- `topRejectReasons`;
- gaps entre pontos raw e aceitos.

Se `rawPoints` for baixo, investigue captura/background/permissoes. Se raw for alto e `acceptedByRelaxedFilter` ficar muito acima do filtro atual, investigue thresholds. Se accepted for alto e a rota visual nao acompanhar, investigue renderizacao/throttle.

## Interpretando Bugs

### GPS ruim

Procure por:

- `LOCATION_POINT_RECEIVED`;
- `LOCATION_POINT_REJECTED`;
- `reason: bad_accuracy`, `gps_jump`, `too_fast`, `duplicate_point`, `invalid_timestamp`, `out_of_order`.

Compare `rawPointsCount`, `trustedPointsCount`, `accuracy` e `distance`.

### Background

Procure por:

- `APP_BACKGROUND`;
- `ACTIVE_RUN_SAVED` com `source: auto_checkpoint`;
- `LOCATION_WATCHER_STARTED`;
- `LOCATION_WATCHER_RESTARTED`;
- `APP_ACTIVE`.

Se o app voltou sem rota, verifique se depois de `APP_ACTIVE` aparece `RECOVERY_COMPLETED` e `MAP_ROUTE_HYDRATED`.

### Recovery

Procure por:

- `RECOVERY_STARTED`;
- `RECOVERY_LOADED_ACTIVE_RUN`;
- `RECOVERY_MERGED_STATE`;
- `ACTIVE_RUN_EMPTY_OVERWRITE_BLOCKED`;
- `ACTIVE_RUN_DISTANCE_REGRESSION_BLOCKED`;
- `RECOVERY_COMPLETED` ou `RECOVERY_FAILED`.

Esses eventos indicam se o merge preservou segmentos e distancia.

### Mapa

Procure por:

- `MAP_ROUTE_HYDRATED`;
- `MAP_GEOJSON_REBUILT`;
- `MAP_ROUTE_RENDERED`;
- `MAP_ERROR`.

Compare `routePointsCount`, `routeSegmentsCount` e `displayPointsCount`.

### Sync

Procure por:

- `RUN_SAVED_LOCAL`;
- `RUN_SYNC_QUEUED`;
- `RUN_SYNC_SUCCESS`;
- `RUN_SYNC_FAILED`.

Se uma corrida finalizada nao apareceu no Firestore, exporte o bundle e verifique `syncStatus`, `offlineStatus` e `lastSyncError`.

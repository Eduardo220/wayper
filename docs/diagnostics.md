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

`RUN_SESSION`, `RUN_TRACKING`, `RUN_RECOVERY`, `LOCATION`, `BACKGROUND`, `STORAGE`, `MAP`, `NOTIFICATION`, `SYNC`, `PERMISSION`, `UI_ACTION`, `PERFORMANCE`, `APP_STATE`, `FIREBASE`, `UNKNOWN`.

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

- `runId` e `localRunId`;
- status da corrida;
- segmentos e contagem de pontos;
- distancia e tempo;
- ultimo ponto e ultimo save local;
- status de watcher/background task;
- appState atual;
- ultimos logs com filtros por nivel e categoria.

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
- `manifest.json`.

Coordenadas exatas ficam desligadas por padrao. O opt-in deve ser ativado explicitamente na tela antes de uma corrida de teste. Sem opt-in, coordenadas sao mascaradas.

Tambem e possivel usar:

```js
import { exportDiagnosticsBundle } from "../services/diagnostics/runDiagnosticsService.js";

const bundle = await exportDiagnosticsBundle();
```

## Upload opcional

O export local sempre funciona. O envio remoto so e habilitado quando:

`EXPO_PUBLIC_WAYPER_DIAGNOSTICS_UPLOAD_ENABLED=true`

Quando habilitado, o ZIP vai para Firebase Storage e o Firestore recebe somente metadata e o resumo `gpsFilterReport`. O conteudo NDJSON nao e salvo em documento Firestore.

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

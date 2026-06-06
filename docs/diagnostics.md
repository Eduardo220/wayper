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

Em dev, abra pelo menu lateral: `Diagnostico`.

A tela mostra:

- `runId` e `localRunId`;
- status da corrida;
- segmentos e contagem de pontos;
- distancia e tempo;
- ultimo ponto e ultimo save local;
- status de watcher/background task;
- appState atual;
- ultimos logs com filtros por nivel e categoria.

## Exportacao

Na tela `Diagnostico`:

- `Copiar`: copia o bundle JSON para a area de transferencia;
- `Exportar JSON`: tenta compartilhar um arquivo `.json`;
- `Limpar`: remove logs locais.

O bundle inclui metadata, logs recentes, erros, resumo da corrida ativa, storage, permissoes e watcher/background. Dados sensiveis sao removidos.

Tambem e possivel usar:

```js
import { exportDiagnosticsBundle } from "../services/diagnostics/runDiagnosticsService.js";

const bundle = await exportDiagnosticsBundle();
```

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

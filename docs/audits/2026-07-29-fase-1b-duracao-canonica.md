# Fase 1B — duração canônica da corrida

Data: 2026-07-29

Status: implementada; automação aprovada; validação física pendente

## Objetivo

Fechar a duração ativa como uma unidade pequena da fundação confiável. A regra
é `fim efetivo - startedAt - totalPausedMs`: quando a timeline é confiável, a
duração armazenada é somente cache e não pode reincorporar uma pausa.

Esta fase cobre pausa, retomada, recovery e congelamento do instante final. Não
inclui a otimização do checkpoint comprometido, lifecycle nativo, cercas gerais
de identidade, modo foco, histórico/sync ou experiência pós-corrida.

## Diagnóstico

A primeira versão do caminho escalar v2 ainda continha quatro riscos:

- `Math.max(durationMs, duração derivada)` permitia que um cache contaminado
  pela pausa vencesse a timeline;
- `FINISHING` e `STOPPING` caíam no fallback baseado em `Date.now()` e podiam
  continuar contando durante atraso ou recovery;
- `FINISHED` aceitava ponto GPS posterior ao instante final;
- merges e o envelope offline podiam combinar status, duração e pausa de
  snapshots diferentes, reabrindo uma corrida pausada ou reduzindo o total
  pausado.

Também foi identificado que um recovery legado `PAUSED` sem fronteira temporal
inventava `pausedAt` no momento da hidratação, inflando toda a espera offline.

## Contrato fechado

| Estado | Fronteira usada pela duração |
| --- | --- |
| `RUNNING` | `now` e observações escalares coerentes já persistidas |
| `PAUSED` | `pausedAtMs`; sem fronteira legada, fallback armazenado congelado |
| `RECOVERING`/`ERROR_RECOVERABLE` | semântica preservada da origem pausada, terminal ou ativa |
| `FINISHING`/`FINISHED` | primeiro `finishedAtMs`, imutável até o save mínimo |
| `STOPPING`/`CANCELLED` | fronteira terminal explícita ou instante da transição |

Regras adicionais:

- aliases de pausa são reconciliados pelo maior valor válido;
- `PAUSED -> RUNNING` só é publicado por merge quando o snapshot prova a
  retomada por segmento ou pelo total pausado acumulado;
- o caminho v2 consultado a cada tick não lê path, segmentos ou renderização;
- normalização e recovery podem reconciliar geometria legada uma vez, fora do
  tick da UI;
- o espelho offline deriva duração da mesma timeline e persiste os aliases de
  pausa monotonicamente;
- retry de finalização não substitui a primeira fronteira congelada por um
  horário posterior.

Não houve versão nova de schema, chave de storage ou dependência.

## Arquivos da unidade

- `src/services/runTracking/activeRunState.js`;
- hunks de congelamento em
  `src/services/runTracking/activeRunTrackingService.js`;
- `src/services/runOfflineStorageService.js`;
- hunk de timing em `src/services/run/runRecoveryService.js`;
- hunk de precedência em `src/services/run/runFinalizationService.js`;
- hunk consumidor da fronteira canônica em `src/screens/MapScreen.js`;
- testes focados e de integração dos mesmos domínios.

## Validações executadas

Gate focado da árvore atual:

```bash
npm test -- --runInBand \
  src/services/runTracking/__tests__/activeRunState.test.js \
  src/services/runTracking/__tests__/runStateReconciler.test.js \
  src/services/runTracking/__tests__/activeRunTrackingService.test.js \
  src/services/runTracking/__tests__/activeRunRuntimeService.test.js \
  src/services/run/__tests__/activeRunLocalFirst.integration.test.js \
  src/services/run/__tests__/runAutoSaveService.test.js \
  src/services/run/__tests__/runNotificationService.test.js \
  src/services/run/__tests__/runFinalizationService.test.js \
  src/services/__tests__/runOfflineStorageService.test.js
```

Resultado final: 9 suítes e 171 testes aprovados, 0 snapshots.

```bash
npm test -- --runInBand
```

Resultado final da árvore: 56 suítes e 604 testes aprovados, 0 snapshots.

O índice também foi materializado isoladamente sobre o `HEAD` anterior, sem as
mudanças futuras presentes na árvore de trabalho:

- gate focado isolado: 8 suítes e 132 testes aprovados, 0 snapshots;
- suíte completa isolada: 53 suítes e 525 testes aprovados, 0 snapshots;
- `git diff --cached --check`: aprovado;
- export Android isolado: aprovado, 2.334 módulos e bundle Hermes de 10,9 MB.

A suíte `activeRunRuntimeService.test.js` aparece no gate da árvore atual, mas
está não rastreada e pertence à próxima unidade; por isso, corretamente, não
existe no índice isolado. O export não equivale a build nativo nem a teste em
dispositivo físico.

## Riscos e validações pendentes

- falta repetir pausa longa, retomada, kill/reabertura e finalização em Android
  físico com tela apagada e background;
- snapshots legados sem timeline completa usam fallback conservador; a
  normalização cria uma fronteira idempotente, mas não inventa precisão;
- `FINISHING` legado sem `finishedAtMs` usa `lastUpdatedAtMs` como fallback;
- não houve build nativo, teste físico, deploy ou release nesta fase.

## Próxima fase

Unidade 2 — checkpoint comprometido sem rebuild. O próximo commit deve conter
somente persistência incremental, contadores e testes correspondentes, sem
absorver lifecycle nativo ou modo foco.

Rollback previsto: reverter somente o commit desta fase. O schema v2 e as
chaves existentes permanecem compatíveis.

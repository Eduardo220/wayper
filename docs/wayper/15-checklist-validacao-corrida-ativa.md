# Checklist de validacao fisica da corrida ativa

Este roteiro valida a corrida ativa em aparelho real Android, principalmente segundo plano, tela desligada, notificacao e recovery.

## Preparacao

- Usar build instalada no aparelho, nao apenas simulador.
- Garantir permissao de localizacao precisa em primeiro plano.
- Garantir permissao de localizacao em segundo plano quando o Android oferecer.
- Garantir permissao de notificacao.
- Desativar, se possivel, restricoes agressivas de bateria para o app durante o teste.
- Antes do teste, limpar corridas ativas antigas ou registrar se existe recovery esperado.
- Ativar/exportar diagnostico ao final em `Configuracoes > Diagnostico`.

## Reteste curto do hardening C/D

Este reteste não exige repetir imediatamente a caminhada longa já aprovada para
tela apagada. Ele valida as regressões críticas na nova build:

1. iniciar uma corrida nova e confirmar o ID/status ativo;
2. pausar no app, aguardar pelo menos 20 segundos e retomar;
3. pausar pela notificação e retomar pela notificação;
4. finalizar ainda em pausa em uma repetição curta;
5. tocar duas vezes rapidamente em `Finalizar`;
6. salvar os detalhes e confirmar uma única corrida no histórico;
7. reabrir o app e conferir duração, rota, distância e ausência de recovery
   duplicado.

Critérios obrigatórios:

- nenhuma ação muda apenas o rótulo: snapshot, app e notificação concordam;
- o período pausado não entra no tempo ativo;
- imediatamente após retomar, o cronômetro deve permanecer próximo do valor
  pausado, somando somente os segundos novamente ativos;
- apenas o ID salvo é limpo;
- o resumo não fecha se o save de detalhes falhar;
- território, XP e fila não atrasam a confirmação local;
- no caminho feliz não podem ocorrer `LoadBundleFromServerRequestError` nem
  `FINISH_FAILED`;
- a ordem observável é save mínimo confirmado -> cleanup -> liberação da UI ->
  agendamento/processamento derivado;
- falha induzida pré-save registra `FINISH_FAILED` e depois
  `RUN_FINISH_FAILURE_STATE_RESTORED` ou
  `RUN_FINISH_FAILURE_RECOVERY_PRESENTED`; nunca termina em `IDLE` com snapshot
  recuperável;
- `RUN_ACTIVE_CLEANUP_ID_MISMATCH_BLOCKED`, se ocorrer, reprova o cenário e
  exige investigação antes de nova feature.

### Execução parcial registrada em 2026-07-24

- [x] corrida nova iniciada no Dev Client;
- [x] pausa no app em `00:21`, espera superior a 20 segundos e retomada sem salto
  do período pausado;
- [x] segunda pausa e finalização com resumo em `01:07`;
- [x] save mínimo local, cleanup, detalhes salvos e retorno a
  `Iniciar Corrida`;
- [x] tarefas derivadas iniciadas somente após `RUN_FINISH_UI_RELEASED`;
- [x] ausência de `FINISH_FAILED` e `LoadBundleFromServerRequestError`;
- [ ] pausa/retomada pela notificação;
- [ ] duplo toque na finalização;
- [ ] reabertura do histórico com rota/distância;
- [ ] offline, force-stop, zonas, preview/release e economia agressiva.

A corrida antiga recuperada antes desse reteste não serve como prova de duração:
ela continha checkpoint legado contaminado. A evidência limpa de tempo é a
corrida nova descrita acima.

## Cenario 1: Primeiro plano por 5 minutos

1. Abrir `Mapa`.
2. Iniciar `Corrida Livre`.
3. Caminhar/correr por 5 minutos com a tela ligada.
4. Confirmar que mapa, card, tempo, distancia, status e botoes avancam juntos.
5. Exportar diagnostico se houver divergencia.

Logs esperados:

- `RUN_STARTED`
- `FOREGROUND_LOCATION_RECEIVED`
- `RUN_STATE_RECONCILED`
- `RUN_DISTANCE_RECALCULATED`
- `RUN_ELAPSED_RECALCULATED`
- `RUN_UI_STATE_APPLIED`
- `MAP_ROUTE_HYDRATED`

## Cenario 2: Background por 10 minutos

1. Iniciar corrida em primeiro plano.
2. Confirmar que a notificacao persistente apareceu.
3. Mandar o app para background por 10 minutos.
4. Voltar ao app.
5. Confirmar que tempo e distancia correspondem ao periodo real e que o mapa nao perdeu rota.

Logs esperados:

- `RUN_BACKGROUND_TASK_STATUS`
- `BACKGROUND_LOCATION_RECEIVED`
- `RUN_BACKGROUND_TASK_HANDLED`
- `RUN_STATE_RECONCILED`
- `RUN_UI_STATE_APPLIED`
- `ACTIVE_RUN_STALE_SNAPSHOT_BLOCKED` somente se algum snapshot antigo tentou vencer.

## Cenario 3: Tela desligada por 12+ minutos

1. Iniciar corrida.
2. Bloquear a tela do aparelho por pelo menos 12 minutos.
3. Desbloquear e abrir o app.
4. Confirmar que o tempo nao fica preso em `01:10` nem em snapshot antigo.
5. Confirmar que a distancia do card bate com a rota exibida e com o historico final.

Logs esperados:

- `RUN_BACKGROUND_TASK_STATUS`
- `BACKGROUND_LOCATION_RECEIVED`
- `RUN_ELAPSED_RECALCULATED`
- `RUN_DISTANCE_RECALCULATED`
- `RUN_UI_STATE_APPLIED`
- `ACTIVE_SEGMENT_NORMALIZED` se route chunks trouxerem segmento ativo com fim indevido.

## Cenario 4: Abrir pela notificacao

1. Com corrida `RUNNING`, mandar o app para background.
2. Tocar na notificacao persistente.
3. Confirmar que abre a tela da corrida ativa, sem criar corrida nova.
4. Confirmar que mapa, card, status e botoes voltam sincronizados.

Logs esperados:

- `RUN_RECONCILE_STARTED` com reason `notification_open`
- `RUN_STATE_SOURCE_SELECTED`
- `RUN_STATE_RECONCILED`
- `RUN_NOTIFICATION_OPEN_RESTORE_COMPLETED`
- `RUN_UI_STATE_APPLIED`

## Cenario 5: Pausar e retomar

1. Iniciar corrida.
2. Pausar pelo app.
3. Aguardar 2 minutos parado ou caminhando.
4. Retomar.
5. Confirmar que o tempo pausado nao entra no tempo ativo e que a rota nao liga artificialmente a pausa.
6. Repetir usando acao da notificacao, quando disponivel.

Logs esperados:

- `PAUSE_PRESSED`
- `PAUSE_SUCCESS`
- `RESUME_PRESSED`
- `RESUME_SUCCESS`
- `RUN_STATE_RECONCILED`
- `RUN_UI_STATE_APPLIED`

## Cenario 6: Finalizar

1. Finalizar a corrida depois de pelo menos 12 minutos totais.
2. Pressionar `Finalizar` apenas uma vez; depois repetir o teste pressionando duas vezes rapidamente.
3. Confirmar que a corrida salva uma unica vez.
4. Confirmar que historico, resumo, card final e mapa usam os mesmos valores.
5. Confirmar que a corrida ativa foi limpa depois do save local.
6. Confirmar que `Iniciar Corrida` nao aparece enquanto a UI esta em `Finalizando...`.
7. Em corrida por zonas, confirmar que o resumo e o historico aparecem mesmo se a captura territorial ainda estiver pendente.

Logs esperados:

- `FINISH_PRESSED`
- `RUN_FINISH_FINAL_VALUES`
- `RUN_FINISH_LOCAL_MIN_SAVE_STARTED`
- `FINISH_SUCCESS`
- `RUN_FINISH_SAVED`
- `RUN_FINISH_LOCAL_MIN_SAVE_COMPLETED`
- `RUN_FINISH_UI_RELEASED`
- `RUN_FINISH_DEFERRED_TASKS_SCHEDULED`
- `RUN_SAVED_LOCAL`
- `RUN_ACTIVE_CLEARED`

## Cenario 7: Matar app e restaurar

1. Iniciar corrida.
2. Mandar app para background.
3. Encerrar o processo pelo seletor do Android.
4. Reabrir pelo icone ou pela notificacao, se ainda existir.
5. Confirmar que a corrida volta `RUNNING` ou `PAUSED`, conforme estado real.
6. Continuar por mais 2 minutos e finalizar.

Logs esperados:

- `RECOVERY_STARTED`
- `RECOVERY_LOADED_ACTIVE_RUN`
- `RUN_ROUTE_CHUNKS_RESTORED`
- `RUN_STATE_SOURCE_SELECTED`
- `RUN_STATE_RECONCILED`
- `RECOVERY_COMPLETED`
- `RUN_UI_STATE_APPLIED`

## Cenario 8: Diagnostico de emergencia e finish concorrente

1. Iniciar corrida livre em primeiro plano.
2. Tocar no atalho `Diagnostico` do card `Wayper live`.
3. Confirmar que o artefato compartilhado e JSON leve, com `light: true` e `fullExportDeferred: true`.
4. Repetir tocando em `Diagnostico` e imediatamente `Finalizar`.
5. Confirmar que a finalizacao vence, o estado `EXPORTANDO` some e a corrida aparece no resumo/historico local.
6. Depois da finalizacao, abrir `Configuracoes > Diagnostico` e exportar o ZIP completo.

Logs esperados:

- `RUN_EMERGENCY_DIAGNOSTICS_EXPORT_STARTED`
- `RUN_EMERGENCY_DIAGNOSTICS_EXPORT_SUCCESS` ou `RUN_DIAGNOSTIC_SHARE_TIMEOUT_OR_FAILED`
- `RUN_DIAGNOSTIC_EXPORT_CANCELLED_FOR_FINISH` quando finalizar durante export
- `RUN_FINISH_LOCAL_MIN_SAVE_COMPLETED`
- `RUN_FINISH_UI_RELEASED`

## O que comparar

- Tempo do card vs duracao real aproximada.
- Distancia do card vs rota do mapa.
- Distancia/tempo do resumo final vs historico.
- `acceptedPointsCount`/`trustedPointsCount` crescendo de forma monotona.
- `dedupedTrustedPointsCount` maior que zero apenas quando houver ponto duplicado.
- Ausencia de regressao visual: procurar `RUN_UI_STATE_STALE_UPDATE_BLOCKED`, `RUN_UI_DISTANCE_REGRESSION_BLOCKED`, `RUN_UI_ELAPSED_REGRESSION_BLOCKED`.
- Se houver `ACTIVE_RUN_SAVE_FAILED`, verificar `storageFull`.

## Sinais de falha

- Card preso em tempo antigo enquanto o mapa avanca.
- Distancia do card menor que distancia anterior sem log de bloqueio.
- `RUNNING` com segmento ativo contendo `endedAt`/`endTimestamp`.
- `RUN_NOTIFICATION_OPEN_RESTORE_COMPLETED` ausente depois de abrir pela notificacao.
- `RUN_BACKGROUND_TASK_STATUS` sem `started`, `handled` ou `already_started` durante tela bloqueada.
- Finalizacao duplicada no historico para o mesmo `runId`.

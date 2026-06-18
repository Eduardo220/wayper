# Regras de caminhada e corrida

## Tipos de atividade

O MVP deve aceitar dois tipos de atividade:

- Caminhada.
- Corrida.

Os dois tipos usam GPS real, rota, distância, duração, XP e resumo. Diferenças finas de validação podem existir no futuro, mas o MVP deve manter a regra simples.

## Início da atividade

Antes de iniciar uma atividade, o app deve verificar:

- Usuário autenticado.
- Permissão de localização concedida.
- GPS disponível.
- Precisão inicial aceitável.
- Nenhuma outra atividade ativa.

Ao iniciar:

- Criar um estado local de atividade ativa.
- Registrar horário de início.
- Registrar tipo da atividade.
- Iniciar coleta de localização.
- Mostrar tela de atividade ativa.

## Atividade em andamento

Durante a atividade, o app deve acompanhar:

- Duração.
- Distância estimada.
- Pontos GPS válidos.
- Precisão dos pontos.
- Estado de pausa.
- Possível perda de sinal.

O app deve deixar claro quando o GPS estiver ruim ou quando parte da rota não estiver sendo considerada confiável.

## Pausa

O usuário pode pausar a atividade.

Durante a pausa:

- O tempo pausado não deve contar como tempo ativo.
- A distância não deve crescer.
- Pontos GPS coletados durante pausa não devem gerar rota válida.
- O app pode continuar monitorando localização de forma reduzida para melhorar retomada.

Pausas devem ser registradas para auditoria e resumo.

## Retomada

Ao retomar:

- Registrar horário de retomada.
- Voltar a contar tempo ativo.
- Retomar coleta de pontos válidos.
- Evitar conectar diretamente o último ponto antes da pausa ao primeiro ponto após a pausa se houver deslocamento grande.

Se o usuário se deslocou durante a pausa, o app deve tratar o trecho como lacuna, não como rota conquistada.

## Encerramento

Ao encerrar:

- Parar coleta de localização.
- Registrar horário de término.
- Calcular duração ativa.
- Calcular distância válida.
- Processar rota.
- Calcular XP.
- Calcular conquista territorial inicial.
- Persistir atividade e resumo no Firestore.
- Mostrar tela de resumo.

Atividades muito curtas podem ser salvas como rascunho, descartadas ou marcadas como inválidas. Essa regra ainda precisa ser decidida em [[10-decisoes-do-projeto]].

## Modo offline e recuperação

A corrida ativa deve ser offline-first:

- Ao iniciar uma atividade, o app cria um estado local persistido da corrida ativa.
- Durante a atividade, pontos GPS aceitos, distância, duração, modo, status e segmentos são salvos localmente.
- Pausa e retomada atualizam o estado local e criam separação de segmento para evitar linhas artificiais.
- Finalizar a corrida não depende de Firestore; o resumo final fica salvo localmente antes de abrir a tela de confirmação.
- Ao salvar o resumo, a corrida entra no histórico local com `syncStatus: PENDING` e deve aparecer como pendente até a sincronização remota concluir.
- Historico e detalhes devem abrir pela copia local (`runs`) mesmo sem internet, por `localRunId`, `remoteRunId` ou id legado.
- Corridas com `PENDING_SYNC`, `SYNC_FAILED`, `LOCAL_ONLY` ou `SYNCED` continuam visiveis; corridas `RUNNING`, `PAUSED`, `RECOVERING` e `FINISHING` nao aparecem como finalizadas.
- A tela de detalhes deve usar metricas salvas e rota visual de `renderPath`/`segments`, preservando `trustedPath` para dados oficiais.
- Se o app fechar durante a corrida, ao reabrir deve restaurar a atividade como em andamento ou pausada conforme o último estado persistido.
- Se o app fechar depois de finalizar mas antes de salvar o resumo, ao reabrir deve mostrar novamente o resumo recuperado.
- Firestore é destino de sincronização posterior, não fonte de verdade durante a corrida ativa.

### Recovery consolidado

Regra vigente desde 2026-06-04:

- `wayper:activeRun:v2` e a fonte canonica da corrida ativa.
- `wayper_active_offline_run_v1` e mantido como checkpoint legado e rascunho final temporario.
- Ao reabrir o app, `runRecoveryService` resolve qualquer conflito antes da tela consumir o estado.
- Corrida pausada deve voltar pausada.
- Corrida finalizada ou pendente de sync nao pode voltar como ativa.
- Legado vivo so pode ser aplicado depois de migrado para o snapshot canonico.
- Depois que uma corrida finalizada entra no historico/fila local, os storages de corrida ativa devem ser limpos.

### Consistencia visual e canonica

Regra vigente desde 2026-06-17:

- Mapa, card da corrida, timer, distancia, botoes, notificacao e storage devem derivar do mesmo snapshot reconciliado.
- Se o mapa recebeu pontos novos, o layout da corrida nao pode continuar preso em snapshot antigo.
- `elapsedMs` de uma corrida `RUNNING` nao pode usar `endedAt`/`endTimestamp` do segmento ativo.
- Segmento ativo `RUNNING` deve permanecer aberto; `endedAt` so existe em pausa, cancelamento, encerramento ou fim real de segmento.
- Restore de route chunks, abertura por notificacao e hydrate legado nao podem sobrescrever estado mais novo com snapshot velho.
- Distancia canonica vem de `trustedPath` deduplicado ou de valor canonico monotonicamente preservado; rota visual limitada nao pode reduzir a distancia real.
- Foreground e background podem entregar pontos proximos, mas o merge deve deduplicar por timestamp/coordenada/accuracy antes de recalcular distancia.
- Ao finalizar, o tempo salvo deve ser o maior valor seguro entre storage, UI viva, `finishedAt - startedAt - totalPausedMs` e `lastLocationAt - startedAt - totalPausedMs`.
- Se o storage falhar por falta de espaco, a corrida em memoria e o ultimo backup valido devem ser preservados e o erro precisa ficar auditavel.

### Auto-save e estados offline

Estados praticos da corrida:

- `RUNNING`: corrida ativa coletando pontos.
- `PAUSED`: corrida pausada, preservada assim apos reload.
- `FINISHING`: transicao de encerramento; no recovery deve ser tratada como finalizada, nunca como ativa.
- `FINISHED_LOCAL` / `PENDING_SYNC`: corrida ja salva localmente e aguardando sync.
- `SYNCED`: corrida sincronizada.
- `SYNC_FAILED`: sync falhou, dados locais continuam preservados para retry.

Politica de protecao:

- Checkpoints acontecem por eventos de lifecycle, por AppState, por falhas recuperaveis de GPS e periodicamente durante a corrida ativa.
- Um checkpoint antigo nao pode sobrescrever checkpoint mais recente do mesmo `localRunId`.
- Se o app fechar durante a finalizacao, a recuperacao deve tratar a corrida como rascunho finalizado/pendente, nao como ativa.
- Se Firestore falhar, a corrida permanece no historico local com status pendente ou falho de sync.
- Perda temporaria de localizacao deve registrar lacuna/estado coerente; o app nao deve inventar trajeto falso.

### Notificacao persistente e tela bloqueada

Regras vigentes desde 2026-06-05 para Android:

- Ao iniciar ou recuperar uma corrida ativa, o app deve manter uma notificacao persistente com tempo, distancia, status e acao contextual.
- Corrida `RUNNING` mostra status `Correndo` e acao `Pausar`.
- Corrida `PAUSED` mostra status `Pausada` e acao `Retomar`.
- Pausar ou retomar pela notificacao deve chamar `activeRunTrackingService`, preservar `localRunId`, path e segments, e disparar checkpoint via `runAutoSaveService`.
- A notificacao deve abrir o app na tela de corrida ativa por deep link, sem criar corrida nova e sem empilhar telas.
- Ao finalizar, cancelar ou limpar o snapshot ativo, a notificacao deve ser removida.
- Finalizar pela notificacao nao faz parte desta etapa; o usuario deve abrir o app para confirmar/salvar o resumo.
- Sem permissao de notificacao, a corrida ainda deve funcionar local-first, mas o app precisa avisar que a experiencia em segundo plano pode ser limitada.
- Sem permissao de localizacao em segundo plano, o app nao deve prometer coleta confiavel com tela bloqueada.

## Cancelamento

O usuário pode cancelar uma atividade em andamento.

Regra sugerida:

- Cancelamento não gera XP.
- Cancelamento não gera território.
- O app pode perguntar confirmação antes de descartar.
- O app não deve salvar rota completa se o usuário confirmar descarte, exceto logs técnicos mínimos se necessários e permitidos.

## Caminhada

Caminhada deve aceitar velocidades menores e pausas naturais. O app deve evitar invalidar caminhada apenas por ritmo lento.

Indicadores úteis:

- Distância.
- Duração.
- Ritmo médio.
- XP.
- Território conquistado.

## Corrida

Corrida deve aceitar velocidades maiores, mas ainda compatíveis com deslocamento humano.

Indicadores úteis:

- Distância.
- Duração.
- Pace.
- XP.
- Território conquistado.

Velocidades incompatíveis com corrida humana devem ser marcadas como suspeitas conforme [[05-gps-e-validacao]].

## Regras pendentes

- Distância mínima para salvar atividade.
- Duração mínima para gerar XP.
- Diferença de validação entre caminhada e corrida.
- Critério final para descartar ou invalidar atividade recuperada sem pontos suficientes.
- Retomada após perda prolongada de sinal.


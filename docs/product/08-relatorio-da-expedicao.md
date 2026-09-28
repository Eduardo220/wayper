# Relatório da Expedição

**Status:** aprovado  
**Situação atual:** estado modular persistente implementado; experiência visual
unificada ainda não implementada

O Relatório da Expedição é a principal experiência pós-corrida. Ele transforma
uma atividade já salva em descoberta.

## Propriedades

- rápido, agradável e pulável;
- persistente e reabrível pelo histórico;
- modular e compatível com offline;
- idempotente e recuperável;
- capaz de atualizar blocos separadamente;
- honesto sobre pendências e indisponibilidade.

## Módulos independentes

1. desempenho físico;
2. mapa, trajeto, segmentos, pausas e replay;
3. territórios conquistados, defendidos, perdidos, recuperados ou inéditos;
4. XP, nível, conquistas, streaks, missões e desbloqueios;
5. ranking, ultrapassagens, grupos e competições;
6. desafios e temporadas;
7. recompensas internas ou patrocinadas;
8. exportação e compartilhamento.

Nem todos os módulos são escopo imediato.

## Estados

Cada bloco deve representar, no mínimo, `pending`, `processing`, `ready`,
`failed_retryable`, `failed_permanent` ou `not_applicable`, com versão e horário.
O relatório geral não espera todos os blocos.

Desde a Fase D, `runDeferredTaskQueueService` projeta e persiste esses estados
para métricas, território, progressão, ranking, social e sync. Desafios e
recompensas aparecem como `not_applicable` até suas fases próprias. O contrato
pode ser lido por `runDeferredTaskQueueRepository.getProcessingState()`; a
migração visual de `RunSummaryModal` e `RunDetailScreen` permanece como Fase 3.

Exemplos de texto honesto:

- processando territórios;
- calculando progressão;
- ranking pendente;
- sincronização pendente;
- recompensa temporariamente indisponível.

## Relação com a finalização

O relatório só começa depois do snapshot e do salvamento mínimo confirmados. Sua
animação, provider, replay, share ou falha nunca pode alterar a corrida salva.
`RunSummaryModal` e `RunDetailScreen` devem ser migrados gradualmente; não criar
uma terceira experiência paralela sem plano de substituição.

# Monetização e anúncios

**Assinatura:** direção aprovada  
**Anúncios:** possibilidade secundária, não autorizada para integração nesta fase

## Política absoluta

Anúncios nunca aparecem:

- em atividade ativa ou pausada;
- em notificação de atividade;
- em restauração, alerta de GPS ou erro crítico;
- durante finalização ou antes do salvamento mínimo;
- sobre pausa, retomada ou finalização;
- ao reabrir pela notificação;
- em modal obrigatório do pós-corrida;
- bloqueando histórico ou dados já registrados.

## Locais futuramente avaliáveis

Feed, exploração, ranking, histórico, desafios, grupos, loja, parceiros,
recompensas e um espaço opcional depois do relatório concluído. A presença nesta
lista não autoriza implementação: exige ADR, consentimento, teste, flag e política
de frequência.

## Política central

Uma futura decisão deve passar por equivalente a:

`canShowAd(context, entitlements, appState, consent, frequency, flags)`

O provider só carrega/exibe. A política de produto decide se pode. O domínio da
corrida não conhece anúncios. Indisponibilidade do provider resulta em ausência
de anúncio, nunca erro do fluxo.

## Princípio comercial

Anúncios não são a principal receita nem o único motivo para Plus. Free continua
boa e não recebe incômodos artificiais.

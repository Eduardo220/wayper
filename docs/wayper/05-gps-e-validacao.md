# GPS e validação

## Objetivo

O GPS é a base da Wayper. Ele determina rota, distância, território, XP e rankings. Por isso, o app deve tratar qualidade de localização como regra de produto, não apenas detalhe técnico.

## Precisão mínima

Regra inicial proposta para o MVP:

- Pontos com precisão boa contam normalmente.
- Pontos com precisão intermediária podem contar, mas devem ser avaliados com cautela.
- Pontos com precisão ruim não devem gerar conquista territorial.

Valores sugeridos para validação inicial:

- Até 25 metros: ponto aceitável.
- Entre 25 e 50 metros: ponto utilizável com cautela.
- Acima de 50 metros: ponto suspeito ou inválido para território.

Esses números são proposta inicial e devem ser ajustados com testes reais em dispositivos.

## Pontos inválidos

Um ponto GPS pode ser considerado inválido quando:

- Não possui latitude ou longitude.
- Possui precisão acima do limite aceito.
- Gera salto incompatível com deslocamento humano.
- Indica velocidade incompatível com caminhada ou corrida.
- Foi coletado durante pausa.
- Foi coletado após perda longa de sinal e cria trecho artificial.
- Possui timestamp fora de ordem.

Pontos inválidos não devem gerar território. Dependendo da regra final, também podem não contar para distância e XP.

## Risco de GPS falso

GPS falso ou manipulado é um risco direto para:

- Território conquistado.
- XP.
- Ranking.
- Disputas futuras.

No MVP, a defesa deve ser simples:

- Validar velocidade máxima plausível.
- Detectar saltos bruscos.
- Ignorar pontos com precisão ruim.
- Registrar sinais de suspeita na atividade.
- Evitar recompensas competitivas fortes antes de anti-cheat melhor.

Anti-cheat avançado fica fora do MVP, mas a modelagem deve deixar espaço para marcar atividades suspeitas.

## Perda de sinal

Quando houver perda de sinal:

- O app deve informar o usuário quando possível.
- O tempo pode continuar contando.
- A distância não deve crescer sem pontos confiáveis.
- O território não deve ser conquistado em lacunas.
- Ao recuperar sinal, o app deve evitar criar uma linha direta artificial entre pontos distantes.

Regra sugerida:

- Se a lacuna for curta e o deslocamento for plausível, o trecho pode ser mantido com cautela.
- Se a lacuna for longa ou o salto for grande, separar a rota em segmentos.

## Internet e coleta GPS

A coleta de localização por `expo-location` não deve depender de internet:

- Início, pausa, retomada, finalização, cálculo de distância, tempo, pace e desenho da rota usam GPS e estado local.
- Durante a corrida ativa, nenhum ponto precisa ser gravado no Firestore.
- Se a internet cair, a coleta continua enquanto o GPS e as permissões estiverem disponíveis.
- A corrida finalizada offline permanece local com sincronização pendente.
- Quando a conexão voltar, o app tenta sincronizar o resumo e a rota com Firestore automaticamente.
- Mapa base/cache pode ser afetado por internet, mas isso não deve impedir a captura de GPS nem o salvamento local da corrida.

## Atividade em segundo plano

A Wayper precisa funcionar com o app em segundo plano para registrar atividades reais.

Pontos de atenção:

- Permissões específicas de localização em segundo plano.
- Diferenças entre Android e iOS.
- Indicação clara ao usuário de que a localização será usada durante atividade.
- Tratamento de encerramento inesperado do app.
- Recuperação de atividade ativa quando o app reabrir.

No MVP, a atividade em segundo plano deve ser implementada apenas se for confiável o suficiente. Caso contrário, deve ser registrada como risco em [[13-problemas-conhecidos]].

O estado local da corrida ativa mitiga perda de dados quando o app é reaberto, mas não substitui testes reais de coleta em segundo plano em Android e iOS.

## Economia de bateria

Coleta de GPS pode consumir muita bateria. O app deve equilibrar precisão e consumo.

Diretrizes iniciais:

- Usar alta precisão somente durante atividade ativa.
- Reduzir coleta quando a atividade estiver pausada.
- Evitar atualizações mais frequentes do que o necessário.
- Simplificar rota antes de salvar quando fizer sentido.
- Não manter GPS ativo fora de atividade sem necessidade clara.

## Dados derivados

Antes de gerar XP, ranking ou território, a rota deve passar por validação mínima:

- Filtrar pontos inválidos.
- Separar segmentos com lacunas grandes.
- Calcular distância com pontos válidos.
- Marcar atividade como normal, parcial ou suspeita.

## Pipeline oficial de path

Desde 2026-06-05, a esteira oficial de GPS fica em `src/services/tracking` e deve ser reaproveitada por corrida livre, corrida por zonas, background/recovery, historico, replay e sync. `MapScreen` e componentes de mapa nao devem recalcular distancia nem decidir filtros de GPS.

Papel dos campos:

- `rawPath`: pontos brutos normalizados para diagnostico. Nao altera distancia sozinho.
- `trustedPath`: pontos aceitos pela validacao. E a base de distancia, pace e metricas.
- `renderPath`: pontos preparados para visualizacao. Pode ser simplificado/suavizado, mas nunca altera metricas.
- `segments`: quebras reais de percurso, principalmente pausa explicita e gap tecnico relevante.

Classificacao interna de pontos:

- `accepted`: ponto bom para entrar no `trustedPath`.
- `suspicious`: ponto aceito com cautela por qualidade intermediaria; pode entrar na rota, mas fica contabilizado em debug.
- `discarded`: ponto rejeitado e fora de distancia/territorio.

Motivos comuns de descarte: coordenada invalida, `0,0`, timestamp ausente, timestamp futuro acima de 120s, ponto antigo anterior ao inicio da corrida por mais de 30s, ponto fora de ordem, ponto duplicado, accuracy ruim, salto impossivel, velocidade/aceleracao incompativel, jitter parado, ponto em `PAUSED` ou ponto depois de finalizacao.

Thresholds iniciais para corrida (`run`), centralizados em `trackingConfig.js`:

- Accuracy ideal ate 15m, aceitavel ate 25m, cautelosa ate 35m e hard reject acima de 50m.
- Delta minimo entre pontos: 700ms.
- Distancia minima util em movimento: 3m; parado: 1.5m.
- Velocidade maxima normal: 8.5 m/s; hard reject: 10.5 m/s.
- Aceleracao maxima plausivel: 4.5 m/s2.
- Gap tecnico: acima de 30s com pelo menos 30m, ou salto acima de 120m com intervalo maior que 10s.
- Simplificacao visual live: 2.5m; resumo/historico: 5.5m.

## Distancia, pausas e gaps

A distancia oficial e calculada somente entre pontos do `trustedPath`, dentro do mesmo segmento. O app nunca deve somar:

- ponto descartado;
- jitter parado;
- ponto recebido durante `PAUSED`;
- ponte entre pausa e retomada;
- ponte entre gap longo de GPS;
- ponto antigo chegando depois de um ponto mais novo.

Ao pausar, o segmento atual e fechado. Ao retomar, a corrida continua com os segmentos anteriores preservados e um novo trecho valido nasce sem conectar o deslocamento feito durante a pausa.

Perdas curtas de sinal nao devem fragmentar a rota por si so. Gaps longos ou saltos impossiveis quebram a renderizacao em segmentos para evitar linha reta atravessando a cidade e para impedir distancia inflada.

Lotes de background devem ser ordenados por timestamp antes de entrar no pipeline. Pontos duplicados entre foreground/background sao ignorados pelo mesmo filtro canonico.

## Renderizacao visual

Suavizacao e simplificacao sao apenas visuais e ficam no `renderPath`. Elas existem para reduzir tremedeira e peso de mapa, mas nao podem deslocar a rota para longe dos pontos reais, cortar pausas/gaps, nem modificar `rawPath`, `trustedPath`, distancia, XP ou territorio.

Para rota com um segmento, a renderizacao usa `LineString`. Para multiplos segmentos, usa `MultiLineString`, preservando a ordem dos pontos e evitando conectar pausa/gap.

## Documentos relacionados

- [[03-mecanica-territorios]]
- [[04-regras-corrida]]
- [[06-xp-nivel-ranking]]
- [[13-problemas-conhecidos]]


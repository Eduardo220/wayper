# Mecânica de territórios

## Nota local-first atual

Desde 2026-06-06, a captura territorial por zonas funciona localmente antes do Firestore:

- Territorios atuais ficam em `wayper_territories_v1`.
- Eventos territoriais ficam em `wayper_territory_events_v1`.
- Leaderboards/cache territorial ficam em `wayper_territory_leaderboards_v1`.
- `TerritoryRepository` e a facade preferencial para ler/salvar/atualizar territorios locais.
- `zones` e `@wayper_zones` sao legado e so entram por migracao/compatibilidade explicita.
- Corrida por zonas deve preservar `area`, `areaM2`, `zoneCoords`, `geometry`, `routeGeometry`, `territorySummary`, `territoryEvents` e `capturedCells`.
- Corrida livre nao deve gerar nem preservar territorio falso.
- Firestore e destino posterior de sync; falha remota nao deve apagar territorio local nem esconder corrida do historico.

## Ideia central

A mecânica de territórios transforma deslocamentos reais em conquista no mapa. O usuário caminha ou corre com GPS ativo, e a Wayper converte partes válidas da rota em progresso territorial.

Território não deve ser apenas um desenho decorativo. Ele precisa representar uma relação clara entre esforço físico, localização real e progresso persistido.

## Como o usuário conquista território

No MVP, a conquista deve seguir uma regra simples:

1. O usuário inicia uma atividade de caminhada ou corrida.
2. O app coleta pontos GPS válidos durante a atividade.
3. Ao finalizar, a rota é processada.
4. O sistema identifica trechos válidos da rota.
5. Esses trechos geram território conquistado ou progresso territorial.
6. O resumo mostra distância, duração, XP e conquista.
7. O Firestore salva a atividade e os dados derivados necessários.

No MVP, esse território deve representar progresso individual do usuário. Ele não deve definir posse global, disputa contra outros usuários ou controle compartilhado de áreas.

## Regras iniciais

- Somente atividades finalizadas devem gerar conquista permanente.
- Pontos GPS inválidos não devem contar para território.
- Trechos com precisão ruim devem ser ignorados ou marcados como suspeitos.
- Território deve estar ligado à rota real, não apenas à distância total.
- A conquista deve ser calculada no encerramento da atividade no MVP.
- O usuário deve conseguir ver o resultado da conquista no mapa ou no resumo.
- A regra inicial deve evitar disputa direta entre usuários até que ranking e anti-cheat estejam mais maduros.
- Nenhum usuário deve perder território no MVP.
- A mesma rota não deve gerar bônus ilimitado de território novo.

## Modelo inicial sugerido

Para o MVP, existem duas abordagens possíveis:

- Conquista por células de mapa: dividir o mapa em pequenas zonas e marcar células visitadas.
- Conquista por buffer de rota: criar uma área ao redor da linha percorrida usando uma biblioteca geográfica.

A decisão ainda precisa ser validada. Para implementação inicial, a abordagem deve priorizar simplicidade, custo baixo no Firestore e renderização rápida no mapa.

## Contenção para o MVP

Até decisão humana sobre a estratégia final, a implementação deve tratar território como métrica individual derivada da rota validada. A versão inicial pode mostrar progresso territorial no resumo e no mapa, mas não deve criar mecânica de posse pública, disputa em tempo real, clans ou ranking territorial competitivo.

Se a estratégia escolhida exigir entidades persistidas de território, a modelagem deve ser atualizada em [[08-firebase-firestore]] antes da implementação.

## Pontos em aberto

- Qual tamanho mínimo de território deve ser conquistado?
- A conquista será por células, polígonos, tiles ou buffer da rota?
- Quando o território deve evoluir de progresso individual para modelo compartilhado?
- O usuário perde território algum dia?
- Como evitar duplicação de território em rotas repetidas?
- Qual precisão mínima de GPS deve permitir conquista?
- O cálculo será feito no app, em Cloud Functions ou em ambos?

## Riscos

- Regras territoriais complexas podem atrasar o MVP.
- Polígonos grandes podem afetar performance do mapa.
- Escritas excessivas no Firestore podem aumentar custo.
- GPS falso pode gerar conquista indevida.
- Rota com ruído pode criar território visualmente estranho.
- Disputa entre usuários pode exigir moderação e anti-cheat antes do produto estar pronto.

## Conexões com GPS

A mecânica de território depende diretamente de [[05-gps-e-validacao]].

Regras de precisão, perda de sinal, pontos inválidos e detecção de anomalias devem ser aplicadas antes da conquista. Nenhum território deve ser considerado confiável se a rota de origem não for confiável.

## Conexões com XP

A conquista de território pode gerar XP, mas o MVP deve evitar fórmulas complexas.

Regra inicial sugerida:

- XP por distância válida.
- Bônus pequeno por território novo.
- Nenhum bônus grande por velocidade.

As regras de XP estão em [[06-xp-nivel-ranking]].

## Conexões com ranking

No MVP, ranking deve ser simples ou futuro. Se houver ranking inicial, ele deve usar métricas fáceis de auditar:

- XP total.
- Distância válida total.
- Quantidade de território conquistado.

Disputa por território entre usuários deve ficar fora do MVP, conforme [[02-mvp]].

## Conexões com Firestore

Firestore deve salvar somente o necessário para reconstruir histórico, perfil e território. A modelagem inicial está em [[08-firebase-firestore]].

O app deve evitar gravar um documento por ponto GPS se isso gerar custo excessivo. Rotas longas podem exigir compactação, simplificação ou armazenamento agregado.


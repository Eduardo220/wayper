# Corrida por zonas

A captura de zonas parte dos pontos aceitos pelo tracking, ja filtrados por precisao, saltos de GPS, velocidade impossivel e pausas. Pausas viram segmentos separados; a rota visual salva usa `LineString` ou `MultiLineString` para nao desenhar uma ponte falsa entre trechos.

## Como a rota vira zona

O servico central e `routeToZoneGeometry(points, options)` em `src/services/territory/territoryGeometryService.js`.

Ele normaliza os pontos, remove duplicados/ruido, preserva segmentos e procura areas realmente contornadas pela corrida:

- fechamento do ponto final perto do ponto inicial;
- retorno perto de um ponto anterior quando a rota principal ainda esta aberta;
- auto-intersecoes, corrigidas com `turf.unkinkPolygon` quando necessario.

Nao existe fallback para bounding box, circulo ou convex hull. Se a corrida nao contorna uma area, o status fica `partial`/`invalid` e nada e salvo como zona valida.

## Tolerancias principais

Os valores ficam em `src/services/territory/territoryConfig.js`:

- fechamento normal: `closeDistanceM`;
- fechamento maximo tolerado: `maxCloseDistanceM`;
- minimo de pontos: `minLoopPoints`;
- distancia minima: `minDistanceM`;
- area minima: `minAreaM2`;
- precisao/salto/velocidade: `maxAccuracyM`, `maxJumpM`, `maxSpeedMps`.

A simplificacao usa tolerancia baixa e serve para reduzir peso de renderizacao/sync sem mudar grosseiramente a forma real.

## Persistencia e ranking

Territorios capturados sao salvos localmente em `territories` e sincronizados para `territories/{id}`. O sync tambem espelha o documento em `zones/{id}` com `geometry`, `routeGeometry`, `areaM2`, `color`, `strokeColor`, `fillOpacity`, `bbox`, `center`, `stats` e `source: "zoneRun"`.

O ranking usa os agregados de `users` e `user_territory_stats`; ao capturar uma zona, o app atualiza area total, total de zonas, corridas e distancia. O painel "Ver zonas" no mapa carrega zonas do usuario atual, zonas completas no viewport e zonas do usuario escolhido no ranking sem buscar o mundo inteiro.

## Limitacoes

Rotas muito abertas, micro-zonas, GPS ruim e trajetos curtos sao recusados. Buracos podem aparecer quando o `unkink`/Turf consegue representar a geometria resultante, mas a regra principal e conservadora: e melhor nao capturar do que mostrar territorio que o usuario nao contornou.

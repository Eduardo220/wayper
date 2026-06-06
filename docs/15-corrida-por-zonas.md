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

Territorios capturados sao salvos localmente em `wayper_territories_v1` via `territoryStorageService`/`TerritoryRepository`. Eventos territoriais usam `wayper_territory_events_v1`; leaderboards territoriais usam `wayper_territory_leaderboards_v1` como cache/local.

O sync remoto de territorio continua posterior e separado do sync de runs. `syncTerritoriesToFirestore()` e `syncTerritoryEventsToFirestore()` podem gravar em Firestore quando houver conexao, mas Firestore nao e necessario para concluir a UX local da captura por zonas. O espelho remoto em `zones/{id}` ainda pode existir por compatibilidade, mas `zones` e `@wayper_zones` nao sao storage local novo.

Ao finalizar corrida por zonas com captura valida, a corrida local deve preservar `area`, `areaM2`, `zoneCoords`, `geometry`, `routeGeometry`, `territorySummary`, `territoryEvents` e `capturedCells`. Corrida livre deve salvar historico normalmente e nao deve receber campo territorial falso.

O painel "Ver zonas", mapa, dashboard e feed devem preferir territorios locais/cacheados e tratar Firestore indisponivel como vazio controlado. Leaderboard territorial local/cacheado precisa ter origem clara e nao deve ser apresentado como ranking remoto real quando for apenas cache/demo.

## Limitacoes

Rotas muito abertas, micro-zonas, GPS ruim e trajetos curtos sao recusados. Buracos podem aparecer quando o `unkink`/Turf consegue representar a geometria resultante, mas a regra principal e conservadora: e melhor nao capturar do que mostrar territorio que o usuario nao contornou.

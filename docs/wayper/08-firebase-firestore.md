# Firebase e Firestore

## Status deste documento

Esta é uma proposta inicial de modelagem. Não é uma decisão definitiva.

Antes de criar, renomear ou remover coleções no Firestore, a mudança deve ser registrada em [[10-decisoes-do-projeto]] e refletida neste documento.

## Objetivo

O Firestore deve persistir:

- Usuários.
- Atividades.
- Rotas.
- Conquistas territoriais.
- Dados agregados para perfil.
- Dados preparados para rankings futuros.

O modelo deve evitar custo excessivo, principalmente em rotas com muitos pontos GPS.

## Coleção `users`

Proposta:

`users/{userId}`

Campos possíveis:

- `displayName`
- `email`
- `photoURL`
- `createdAt`
- `updatedAt`
- `xpTotal`
- `level`
- `activityCount`
- `validDistanceMeters`
- `territoryCount`
- `lastActivityAt`

Uso:

- Perfil do usuário.
- Agregados rápidos.
- Base para ranking futuro.

## Coleção `activities`

Proposta:

`activities/{activityId}`

Campos possíveis:

- `userId`
- `type`: `walk` ou `run`
- `status`: `completed`, `cancelled`, `invalid`, `suspect`
- `startedAt`
- `endedAt`
- `activeDurationSeconds`
- `pausedDurationSeconds`
- `distanceMeters`
- `validDistanceMeters`
- `xpEarned`
- `gpsQuality`
- `territoryProcessed`
- `createdAt`
- `updatedAt`

Uso:

- Histórico.
- Resumo.
- Auditoria simples.
- Recalcular agregados se necessário.

## Rotas

Proposta possível:

`activities/{activityId}/routePoints/{pointId}`

Campos possíveis:

- `lat`
- `lng`
- `accuracy`
- `timestamp`
- `speed`
- `valid`
- `segmentIndex`

Alternativa:

- Salvar rota simplificada como array ou objeto compactado em documento separado.

Alerta:

Criar um documento por ponto GPS pode ficar caro. Antes de implementar, avaliar frequência de coleta, duração média das atividades e limites do Firestore.

## Coleção `territoryClaims`

Proposta:

`territoryClaims/{claimId}`

Campos possíveis:

- `userId`
- `activityId`
- `territoryId`
- `claimedAt`
- `source`
- `areaMeters`
- `status`

Uso:

- Registrar conquistas derivadas de atividades.
- Permitir histórico de território.
- Preparar ranking por território.

## Coleção `territories`

Proposta se houver células ou zonas persistidas:

`territories/{territoryId}`

Campos possíveis:

- `type`
- `geometryRef`
- `centerLat`
- `centerLng`
- `createdAt`
- `claimCount`

Essa coleção só deve existir se a estratégia territorial exigir entidades compartilhadas. Para território individual simples, talvez não seja necessária no MVP.

## Rankings

Proposta futura:

`rankings/{rankingId}/entries/{userId}`

Campos possíveis:

- `userId`
- `xpTotal`
- `validDistanceMeters`
- `territoryCount`
- `activityCount`
- `period`
- `updatedAt`

Ranking pode ser derivado de `users` no MVP. Uma coleção dedicada só deve existir se houver necessidade real de performance, período ou ordenação específica.

## Conquistas

Proposta futura:

`achievements/{achievementId}`

`users/{userId}/achievements/{achievementId}`

Uso:

- Medalhas.
- Marcos de distância.
- Marcos de território.
- Eventos futuros.

Fica fora do MVP, exceto se houver uma conquista muito simples e diretamente ligada ao onboarding.

## Agregados

Agregados em `users` devem ser atualizados com cuidado:

- XP total.
- Nível.
- Distância válida total.
- Número de atividades.
- Território conquistado.

Ponto pendente:

- Decidir se agregados serão atualizados no app, por Cloud Functions ou em fluxo híbrido.

## Cuidados de custo

- Evitar escrita excessiva de pontos GPS.
- Evitar leituras grandes para montar histórico simples.
- Usar paginação no histórico.
- Separar dados de resumo de dados pesados de rota.
- Não carregar rotas completas em telas que só precisam de lista.

## Documentos relacionados

- [[03-mecanica-territorios]]
- [[04-regras-corrida]]
- [[05-gps-e-validacao]]
- [[06-xp-nivel-ranking]]
- [[10-decisoes-do-projeto]]


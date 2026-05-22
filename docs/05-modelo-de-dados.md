# Modelo de Dados

Modelo inicial proposto para Firestore. Deve ser ajustado conforme o código real evoluir.

## Coleções sugeridas

```txt
users/{userId}
runs/{runId}
zones/{zoneId}
rankings/{rankingId}
friendships/{friendshipId}
groups/{groupId}
groups/{groupId}/members/{userId}
groups/{groupId}/rankings/{rankingId}
```

## users

Representa o usuário do app.

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | string | Mesmo UID do Firebase Auth. |
| `displayName` | string | Nome público. |
| `email` | string | Email, se permitido pelas regras de privacidade. |
| `photoURL` | string/null | Foto de perfil. |
| `createdAt` | timestamp | Data de criação. |
| `updatedAt` | timestamp | Última atualização. |
| `totalDistanceMeters` | number | Distância total registrada. |
| `totalAreaM2` | number | Área total conquistada. |
| `totalZones` | number | Número de zonas conquistadas. |
| `level` | number | Nível gamificado, se usado. |

## runs

Representa uma corrida registrada.

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | string | ID da corrida. |
| `userId` | string | Dono da corrida. |
| `startedAt` | timestamp | Início. |
| `endedAt` | timestamp | Fim. |
| `durationSeconds` | number | Duração. |
| `distanceMeters` | number | Distância. |
| `averagePace` | number | Ritmo médio. |
| `averageSpeed` | number | Velocidade média. |
| `route` | array | Pontos GPS simplificados ou referência para rota. |
| `status` | string | `completed`, `discarded`, `invalid`, etc. |
| `createdAt` | timestamp | Criação do registro. |

## route point

Formato sugerido para pontos de rota.

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `lat` | number | Latitude. |
| `lng` | number | Longitude. |
| `timestamp` | timestamp/number | Momento da captura. |
| `accuracy` | number/null | Precisão do GPS. |
| `speed` | number/null | Velocidade reportada. |

## zones

Representa uma zona conquistada.

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | string | ID da zona. |
| `userId` | string | Usuário dono. |
| `runId` | string | Corrida que gerou a zona. |
| `geometry` | object | GeoJSON Polygon/MultiPolygon. |
| `areaM2` | number | Área calculada. |
| `createdAt` | timestamp | Criação. |
| `status` | string | `active`, `contested`, `removed`, etc. |

## rankings

Representa rankings agregados.

| Campo | Tipo | Descrição |
| --- | --- | --- |
| `id` | string | Exemplo: `global_area_monthly_2026_05`. |
| `type` | string | `area`, `zones`, `distance`. |
| `period` | string | `global`, `weekly`, `monthly`. |
| `entries` | array | Lista resumida de usuários e pontuações. |
| `updatedAt` | timestamp | Última atualização. |

## Cuidados

- Não salvar dados sensíveis desnecessários.
- Proteger leitura/escrita com regras do Firestore.
- Evitar documentos grandes demais para rotas muito longas.
- Considerar simplificação/compressão de rota.
- Validar se cálculo de ranking deve ficar no client ou em backend controlado.

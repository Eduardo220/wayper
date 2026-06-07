# Arquitetura do Sistema

## Visão geral

O Wayper é um aplicativo mobile construído com React Native e Expo. A persistência, autenticação e backend principal são baseados em Firebase, especialmente Firebase Auth e Firestore. O mapa utiliza MapLibre/OpenFreeMap, e cálculos geográficos podem usar Turf.

## Stack conhecida

| Camada | Tecnologia |
| --- | --- |
| App mobile | React Native |
| Build/dev | Expo e Expo Dev Client |
| Autenticação | Firebase Auth |
| Banco | Firestore |
| Backend/serviços | Firebase e possíveis scripts Node.js |
| Mapa | MapLibre React Native |
| Base de mapa | OpenFreeMap |
| Geolocalização | Expo Location |
| Geoprocessamento | Turf |
| Testes | Jest |
| Android build | Gradle via scripts do projeto |

## Ambientes

| Ambiente | Branch | Identificador esperado |
| --- | --- | --- |
| Desenvolvimento | `develop` | App/dev client, pacote dev |
| Produção | `main` | App oficial/release |

## Componentes principais

### App mobile

Responsável por:

- Autenticação do usuário.
- Navegação entre telas.
- Exibição do mapa.
- Registro de corrida.
- Leitura e escrita de dados no Firebase.
- Exibição de rankings, perfil, histórico e zonas.

### Firebase Auth

Responsável por:

- Login.
- Cadastro.
- Sessão autenticada.
- Identificação do usuário para regras de acesso.

### Firestore

Responsável por armazenar:

- Dados de usuário.
- Corridas.
- Rotas.
- Zonas conquistadas.
- Rankings agregados ou dados base para ranking.
- Relações sociais, se existirem.

### Mapa e localização

Responsável por:

- Mostrar posição atual.
- Desenhar rotas.
- Desenhar zonas conquistadas.
- Exibir áreas próprias e de outros usuários.
- Atualizar feedback visual durante a corrida.

## Fluxo macro de corrida

1. Usuário autentica.
2. Usuário abre tela de corrida/mapa.
3. App solicita permissão de localização.
4. Usuário inicia corrida.
5. App coleta pontos GPS.
6. App calcula métricas parciais.
7. Usuário finaliza corrida.
8. App valida a corrida.
9. App salva a corrida finalizada localmente na chave `runs`.
10. App enfileira sync remoto idempotente para Firestore.
11. App calcula/preserva dados de zonas quando a corrida for por zonas.
12. App aplica XP e conquistas locais a partir da corrida finalizada salva.
13. Perfil, dashboard, ranking futuro e histórico são atualizados a partir da base local e do sync posterior.

## Sync local-first de corridas

- A corrida ativa nao depende de Firestore.
- Corridas finalizadas entram no historico local por `sync.saveLocalRun()`.
- A fila de sync parte de `sync.loadLocalRunHistory()` e usa `localRunId`/`remoteRunId` para evitar duplicacao.
- Firestore e destino posterior; falhas remotas deixam a corrida visivel como `SYNC_FAILED`.
- Corridas por zonas preservam dados territoriais existentes; corridas livres nao recebem territorio falso.

## Camada local-first incremental

Desde 2026-06-06, os dominios principais passam a ter facades/repositories finos, sem trocar a fonte de verdade existente:

- `RunRepository`: encapsula `sync.loadLocalRunHistory()`, `sync.findLocalRunById()`, `sync.saveLocalRun()` e `sync.deleteLocalRun()`. A chave local oficial continua sendo `runs`.
- `RunSyncQueueRepository`: encapsula `runSyncQueueService` e agenda/processa sync por `sync.js`, sem criar fila paralela.
- `TerritoryRepository`: encapsula `wayper_territories_v1`, eventos e leaderboards locais. `zones` e `@wayper_zones` ficam legados e so entram por chamada explicita.
- `UserProfileRepository`: usa `wayper_profile_v3` como fallback local e trata Firestore/Storage como melhor esforco para dados publicos e avatar.
- `RankingRepository`: diferencia ranking remoto, cache local e estado vazio. Ranking demo/mock nao deve aparecer como dado real.
- `ProgressionRepository`: encapsula XP, nivel, progresso agregado e eventos locais de XP em `wayper_user_progress_v1` e `wayper_xp_events_v1`.
- `AchievementRepository`: encapsula catalogo, progresso e desbloqueios locais de conquistas em `wayper_achievements_v1` e `wayper_achievement_progress_v1`.
- `LocalMetadataRepository` e `storageMigrationService`: registram schemaVersion por dominio, migrations executadas e storages legados sem apagar dados.

Firestore ainda existe em services de sync, perfil, ranking, feed, amigos, grupos, notificacoes e territorio remoto. A regra nova e mover chamadas diretas de tela para repository/service quando o fluxo for alterado, sem refatorar social/grupos de uma vez.

SQLite nao foi adicionado nesta etapa. AsyncStorage segue aceitavel para a camada atual; SQLite/Expo SQLite deve ser reavaliado se historicos com rotas longas causarem custo perceptivel de parse/carregamento.

## Territorios local-first

Desde 2026-06-06, territorio por zonas tambem segue a arquitetura local-first incremental:

- `wayper_territories_v1` e o storage local oficial de territorios atuais.
- `wayper_territory_events_v1` e o storage local oficial de eventos territoriais.
- `wayper_territory_leaderboards_v1` e o cache/local oficial de leaderboards territoriais.
- `zones` e `@wayper_zones` sao legados. Novo codigo nao deve gravar nesses storages; leitura so por compatibilidade/migracao explicita.
- `TerritoryRepository` e a facade preferencial para telas e services que precisam listar, buscar, salvar, atualizar ou resumir territorios locais.
- Captura territorial de corrida por zonas usa `territoryCaptureService`, persiste localmente e agenda sync futuro por `sync.js`. Firestore e melhor esforco posterior.
- Corrida livre nao deve carregar `area`, `areaM2`, `geometry`, `routeGeometry`, `zoneCoords`, `territorySummary` ou `territoryEvents` falsos.
- Mapa, dashboard e feed devem carregar primeiro dado local/cacheado e tratar remoto indisponivel como estado vazio/controlado.

Sync territorial remoto permanece separado do sync de runs. Falha territorial nao apaga territorio local e nao remove corrida do historico.

## Gamificacao local-first

A base de XP, nivel e conquistas e local-first e nao depende obrigatoriamente de Firestore:

- XP so e calculado depois que uma corrida finalizada valida foi salva localmente em `runs`.
- Corrida ativa, pausada, recovering ou `FINISHING` nao gera XP.
- `ProgressionRepository` e a fonte local de `totalXp`, `level`, progresso para proximo nivel, totais de corrida e eventos de XP.
- `AchievementRepository` e a fonte local de conquistas desbloqueadas e progresso parcial.
- Eventos de XP usam `sourceRunId`/`localRunId` e `type` para idempotencia; retry de sync ou reabertura do app nao deve duplicar XP.
- Corrida livre nunca recebe XP territorial mesmo que payload legado traga area falsa.
- Corrida por zonas pode gerar XP territorial quando houver area/captura/celulas validas ja salvas pela corrida.
- Perfil e dashboard podem ler progresso local mesmo com Firestore indisponivel.
- `src/services/xp/xpService.js`, `src/services/xp/territoryXp.js`, `MedalsWidget`, storage `medals` e `@wayper:medals_awarded_v1` ficam como legado/visual ate migracao explicita; nao sao a fonte oficial de progresso real.

## Pontos que precisam ser definidos

- Regra exata de transformação de rota em zona.
- Se ranking será calculado sob demanda ou pré-agregado.
- Estratégia antifraude.
- Modelo definitivo do Firestore.
- Se haverá Cloud Functions ou apenas lógica client-side no início.
- Politica final de sync remoto para XP e conquistas.

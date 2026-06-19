# Roadmap

Este roadmap organiza a evolucao do Wayper por fases. O status deve refletir o codigo atual na branch `develop`; quando algo depende de aparelho fisico, credencial remota ou release real, nao deve ser marcado como fechado.

## Fase 0: Base funcional

Objetivo: manter o app executavel, com autenticacao, navegacao, mapa e build Android controlado.

| Item | Status atual |
| --- | --- |
| Login/cadastro com Firebase Auth | Implementado, ainda exige validacao recorrente em fluxo real. |
| Navegacao principal | Implementada. |
| Scripts de dev/build Android | Implementados; consultar `package.json`. |
| Sentry/diagnostico | Diagnostico local avancado; Sentry depende de credenciais e validacao autenticada. |
| Variaveis/segredos de ambiente | Parcial; manter secrets fora do repositorio. |

## Fase 1: Corrida, GPS e historico local-first

Objetivo: iniciar, acompanhar, pausar/finalizar, preservar e listar corridas sem depender obrigatoriamente de Firestore.

| Item | Status atual |
| --- | --- |
| Iniciar/pausar/retomar/finalizar corrida | Avancado, com `activeRunTrackingService`/`activeRunState`. |
| Corrida ativa local-first | Avancado; fonte canonica `wayper:activeRun:v2`. |
| Recovery e conflitos | Avancado; `runRecoveryService` centraliza. |
| Autosave/checkpoint | Avancado; `runAutoSaveService`. |
| GPS/path | Avancado; pipeline oficial em `src/services/tracking`. |
| Historico/detalhes offline | Avancado; fonte local `runs`. |
| Sync idempotente de runs | Avancado; `sync.js`/`runSyncQueueService`. |
| Notificacao/background Android | Implementado tecnicamente; validacao fisica dev/release segue pendente. |
| Firestore de runs | Destino posterior/best effort, nao dependencia local. |

## Fase 2: Zonas e territorios

Objetivo: transformar corridas por zonas em territorios locais reais e preparar sync remoto futuro.

| Item | Status atual |
| --- | --- |
| Storage local de territorios | Avancado; `wayper_territories_v1`. |
| Eventos territoriais | Avancado; `wayper_territory_events_v1`. |
| Leaderboards/cache territoriais | Inicial; `wayper_territory_leaderboards_v1`. |
| Corrida livre sem territorio falso | Implementado/documentado. |
| Corrida por zonas com area/geometria real | Avancado, dependente da captura local. |
| Sync remoto territorial social/completo | Futuro. |
| Estrategia final de disputa territorial | Pendente. |

## Fase 3: Progresso, perfil, ranking e social

Objetivo: mostrar progresso real/local, Home social e rankings honestos sem confundir cache/demo com dado real.

| Item | Status atual |
| --- | --- |
| XP/progresso local | Inicial avancado; `ProgressionRepository`. |
| Conquistas locais | Inicial avancado; `AchievementRepository`. |
| Sync remoto XP/conquistas | Futuro. |
| Perfil offline/cache/local | Avancado; `UserProfileRepository` + `profileStats`. |
| Ranking com origem explicita | Avancado; `remote/cache/local/empty/demo`. |
| Home social | Inicial avancado; `socialHomeRepository`. |
| Stories locais | Implementado localmente como `PENDING_SYNC`; upload remoto futuro. |
| Feed/Friends/Groups | Parcial; ainda ha trechos Firestore-first. |

## Fase 4: Compartilhamento, onboarding e diagnostico

| Item | Status atual |
| --- | --- |
| Onboarding local-first | Implementado; `wayper:onboarding:v1:completed`. |
| Permissoes sem loop | Implementado via `src/services/permissions.js`, seguir validando. |
| Estados vazios reutilizaveis | Implementado em `src/components/states`. |
| Share `Imagem` | Implementado em `RunShareModal`. |
| Share `Tracado PNG` | Implementado; respeita `segments/gaps`. |
| Adicionar ao story | Implementado localmente, `PENDING_SYNC`. |
| Diagnostico/export ZIP | Avancado; coordenadas mascaradas por padrao. |

## Fase 5: Producao

Objetivo: publicar com build, assinatura, telemetria e validacao fisica reais.

| Item | Status atual |
| --- | --- |
| Build dev Android | Validado em rodada anterior e deve ser revalidado a cada release. |
| Kotlin compile dev debug | Validado na rodada local-first. |
| Build release oficial | Pendente de assinatura real e checklist completo. |
| Assinatura Android release | Pendente; debug-signed prod APK nao e publicavel. |
| Source maps/Sentry autenticado | Pendente sem credenciais/painel validado. |
| Teste real Android background/GPS/notificacao | Pendente antes de considerar fechado. |
| Play Store/rollback | Futuro. |

## Fora de escopo por enquanto

- Monetizacao.
- Marketplace.
- Treinos pagos.
- Wearables.
- iOS em producao, salvo decisao futura.
- SQLite antes de medicao real.

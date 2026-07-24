# Roadmap

Este roadmap organiza a evolucao do Wayper por fases. O status deve refletir o codigo atual na branch `develop`; quando algo depende de aparelho fisico, credencial remota ou release real, nao deve ser marcado como fechado.

## Sequência oficial desde 2026-07-24

| Fase | Objetivo | Estado em 2026-07-24 |
| --- | --- | --- |
| 1 — Fundação confiável | Tracking, offline, background, recovery, finalização e validação física | Parcialmente implementada; gate físico reprovado e reteste pendente |
| 2 — Pipeline da Expedição | Extrair finalização, formalizar save mínimo e resultados idempotentes | Núcleo implementado na Fase D; gate físico reprovado, remediações aguardam reteste |
| 3 — Relatório da Expedição | Experiência modular, parcial, persistente e reabrível | Planejada |
| 4 — Retenção | Progressão, conquistas, streaks e desafios com regras consolidadas | Parcial na base; expansão planejada |
| 5 — Wayper Plus | Entitlements e benefícios positivos | Aprovada conceitualmente |
| 6 — Wayper Pro | Ferramentas para organizadores/comunidades | Em validação |
| 7 — Parceiros | Campanhas, recompensas e desafios contextuais | Aprovada conceitualmente |
| 8 — Pagamentos | Providers substituíveis e confirmação segura | Aprovada conceitualmente; integração não autorizada |
| 9 — Ecossistema | Eventos, criadores, temporadas e marketplace futuro | Hipóteses/planejamento futuro |

Fases posteriores não autorizam antecipar SDK, schema remoto ou UI comercial. O
gate físico da fase 1 continua aberto. A Fase D foi executada por solicitação
humana explícita como extração local, reversível e coberta por testes
automatizados; isso não equivale a validar produção. Entre as fases 2 e 3, o gate
continua sendo um pipeline persistente e idempotente, agora implementado no
núcleo e ainda pendente de validação física e integração visual.

## Base técnica atual: funcional

Objetivo: manter o app executavel, com autenticacao, navegacao, mapa e build Android controlado.

| Item | Status atual |
| --- | --- |
| Login/cadastro com Firebase Auth | Implementado, ainda exige validacao recorrente em fluxo real. |
| Navegacao principal | Implementada. |
| Scripts de dev/build Android | Implementados; consultar `package.json`. |
| Sentry/diagnostico | Diagnostico local avancado; Sentry depende de credenciais e validacao autenticada. |
| Variaveis/segredos de ambiente | Parcial; manter secrets fora do repositorio. |

## Base técnica atual: corrida, GPS e histórico local-first

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
| Notificacao/background Android | Tela apagada/reentrada passaram no Dev Client; ações da notificação falharam e aguardam reteste das correções. |
| Firestore de runs | Destino posterior/best effort, nao dependencia local. |

## Base técnica atual: zonas e territórios

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

## Base técnica atual: progresso, perfil, ranking e social

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

## Base técnica atual: compartilhamento, onboarding e diagnóstico

| Item | Status atual |
| --- | --- |
| Onboarding local-first | Implementado; `wayper:onboarding:v1:completed`. |
| Permissoes sem loop | Implementado via `src/services/permissions.js`, seguir validando. |
| Estados vazios reutilizaveis | Implementado em `src/components/states`. |
| Share `Imagem` | Implementado em `RunShareModal`. |
| Share `Tracado PNG` | Implementado; respeita `segments/gaps`. |
| Adicionar ao story | Implementado localmente, `PENDING_SYNC`. |
| Diagnostico/export ZIP | Avancado; coordenadas mascaradas por padrao. |

## Gate de produção

Objetivo: publicar com build, assinatura, telemetria e validacao fisica reais.

| Item | Status atual |
| --- | --- |
| Build dev Android | Validado em rodada anterior e deve ser revalidado a cada release. |
| Kotlin compile dev debug | Validado na rodada local-first. |
| Build release oficial | Pendente de assinatura real e checklist completo. |
| Assinatura Android release | Pendente; debug-signed prod APK nao e publicavel. |
| Source maps/Sentry autenticado | Pendente sem credenciais/painel validado. |
| Teste real Android background/GPS/notificacao | Executado parcialmente e reprovado; nova build/reteste e matriz preview/release pendentes. |
| Play Store/rollback | Futuro. |

## Não autorizados por enquanto

- Integração real de anúncios ou gateway.
- Marketplace aberto.
- Carteira, split, repasse ou moeda conversível.
- WayCoins, baús, passes e rewarded ads.
- Plano Pro sem validação de segmento.
- Treinos/desafios pagos sem decisão própria.
- Wearables.
- iOS em producao, salvo decisao futura.
- SQLite antes de medicao real.

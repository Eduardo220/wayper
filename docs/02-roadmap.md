# Roadmap

> **Status:** vigente<br>
> **Tipo:** planejamento e gates de evolução<br>
> **Escopo:** sequência de entrega do produto e da fundação técnica<br>
> **Última revisão:** 2026-08-01<br>
> **Fonte principal relacionada:** [`docs/product/direcao-estrategica-completa.md`](product/direcao-estrategica-completa.md)

Este roadmap organiza a evolucao do Wayper por fases. O status deve refletir o codigo atual na branch `develop`; quando algo depende de aparelho fisico, credencial remota ou release real, nao deve ser marcado como fechado.

## Ordem principal de evolução

Esta ordem é um gate: uma etapa posterior não compete com uma fundação ainda
insegura.

1. tracking confiável;
2. background;
3. offline;
4. recuperação;
5. persistência;
6. finalização;
7. diagnóstico;
8. pipeline da Expedição;
9. Relatório da Expedição;
10. retenção;
11. planos;
12. parceiros;
13. pagamentos;
14. ecossistema futuro.

## Sequência oficial desde 2026-07-24

| Fase | Objetivo | Estado em 2026-07-24 |
| --- | --- | --- |
| 1 — Fundação confiável | Tracking, offline, background, recovery, finalização e validação física | Parcialmente implementada; pausa/finalização no app aprovadas em reteste curto e gate físico global aberto |
| 2 — Pipeline da Expedição | Extrair finalização, formalizar save mínimo e resultados idempotentes | Núcleo implementado na Fase D; save mínimo/finalização no app aprovados parcialmente, demais cenários físicos pendentes |
| 3 — Relatório da Expedição | Experiência modular, parcial, persistente e reabrível | Planejada |
| 4 — Retenção | Progressão, conquistas, streaks e desafios com regras consolidadas | Parcialmente implementada na base; expansão planejada |
| 5 — Wayper Plus | Entitlements e benefícios positivos | Planejada; direção do Plus aprovada conceitualmente, sem integração autorizada nesta fase |
| 6 — Wayper Pro | Possível proposta para organizadores/comunidades | Em validação; hipótese de segmento e valor distintos do Plus ainda depende de decisão específica |
| 7 — Parceiros | Campanhas, recompensas e desafios contextuais | Planejada; direção aprovada conceitualmente, sem integração autorizada nesta fase |
| 8 — Pagamentos | Providers substituíveis e confirmação segura | Planejada; arquitetura de gateway aprovada conceitualmente e integração bloqueada até decisão própria |
| 9 — Ecossistema | Eventos, criadores, temporadas e marketplace futuro | Em validação; conjunto de hipóteses, cada item promovido exige decisão e planejamento próprios |

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
| Sentry/diagnostico | Parcialmente implementado; diagnóstico local existe e Sentry depende de credenciais e validação autenticada. |
| Variaveis/segredos de ambiente | Parcialmente implementado; manter secrets fora do repositorio. |

## Base técnica atual: corrida, GPS e histórico local-first

Objetivo: iniciar, acompanhar, pausar/finalizar, preservar e listar corridas sem depender obrigatoriamente de Firestore.

| Item | Status atual |
| --- | --- |
| Iniciar/pausar/retomar/finalizar corrida | Parcialmente implementado, com `activeRunTrackingService`/`activeRunState`; validação física permanece aberta. |
| Corrida ativa local-first | Parcialmente implementada; fonte canonica `wayper:activeRun:v2` e gate físico aberto. |
| Recovery e conflitos | Parcialmente implementado; `runRecoveryService` centraliza e cenários físicos permanecem abertos. |
| Autosave/checkpoint | Parcialmente implementado; `runAutoSaveService` existe e ainda requer validação proporcional aos cenários de interrupção. |
| GPS/path | Parcialmente implementado; pipeline oficial em `src/services/tracking` e validação de rua pendente. |
| Historico/detalhes offline | Parcialmente implementado; fonte local `runs` e cenários físicos ainda abertos. |
| Sync idempotente de runs | Parcialmente implementado; `sync.js`/`runSyncQueueService` e remoto real ainda exigem validação. |
| Notificacao/background Android | Tela apagada/reentrada e pausa/finalização no app passaram parcialmente no Dev Client; ações da notificação ainda aguardam reteste das correções. |
| Firestore de runs | Destino posterior/best effort, nao dependencia local. |

## Base técnica atual: zonas e territórios

Objetivo: transformar corridas por zonas em territorios locais reais e preparar sync remoto futuro.

| Item | Status atual |
| --- | --- |
| Storage local de territorios | Parcialmente implementado; `wayper_territories_v1`. |
| Eventos territoriais | Parcialmente implementados; `wayper_territory_events_v1`. |
| Leaderboards/cache territoriais | Parcialmente implementados; `wayper_territory_leaderboards_v1`. |
| Corrida livre sem territorio falso | Implementado/documentado. |
| Corrida por zonas com area/geometria real | Parcialmente implementada, dependente da captura local. |
| Sync remoto territorial social/completo | Planejado. |
| Estrategia final de disputa territorial | Bloqueada; código e documentação histórica divergem e exigem decisão humana. |

## Base técnica atual: progresso, perfil, ranking e social

Objetivo: mostrar progresso real/local, Home social e rankings honestos sem confundir cache/demo com dado real.

| Item | Status atual |
| --- | --- |
| XP/progresso local | Parcialmente implementado; `ProgressionRepository`. |
| Conquistas locais | Parcialmente implementadas; `AchievementRepository`. |
| Sync remoto XP/conquistas | Planejado. |
| Perfil offline/cache/local | Parcialmente implementado; `UserProfileRepository` + `profileStats`. |
| Ranking com origem explicita | Parcialmente implementado; `remote/cache/local/empty/demo`. |
| Home social | Parcialmente implementada; `socialHomeRepository`. |
| Stories locais | Parcialmente implementados localmente como `PENDING_SYNC`; upload remoto planejado. |
| Feed/Friends/Groups | Parcialmente implementados; ainda ha trechos Firestore-first. |

## Base técnica atual: compartilhamento, onboarding e diagnóstico

| Item | Status atual |
| --- | --- |
| Onboarding local-first | Implementado; `wayper:onboarding:v1:completed`. |
| Permissoes sem loop | Implementado via `src/services/permissions.js`, seguir validando. |
| Estados vazios reutilizaveis | Implementado em `src/components/states`. |
| Share `Imagem` | Implementado em `RunShareModal`. |
| Share `Tracado PNG` | Implementado; respeita `segments/gaps`. |
| Adicionar ao story | Implementado localmente, `PENDING_SYNC`. |
| Diagnostico/export ZIP | Parcialmente implementado; coordenadas mascaradas por padrao. |

## Gate de produção

Objetivo: publicar com build, assinatura, telemetria e validacao fisica reais.

| Item | Status atual |
| --- | --- |
| Build dev Android | Implementado e validado em rodada anterior; deve ser revalidado a cada release. |
| Kotlin compile dev debug | Implementado e validado na rodada local-first. |
| Build release oficial | Bloqueado por assinatura real e checklist completo. |
| Assinatura Android release | Bloqueada; debug-signed prod APK nao e publicavel. |
| Source maps/Sentry autenticado | Bloqueado sem credenciais e evidência no painel. |
| Teste real Android background/GPS/notificacao | Executado parcialmente; background/reentrada e pausa/finalização no app têm evidência, enquanto notificação, rota real, offline e matriz preview/release permanecem pendentes. |
| Play Store/rollback | Planejado; depende dos gates de release. |

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

# Resumo da rodada local-first

Data de consolidacao: 2026-06-19  
Branch de referencia: `develop`

## Objetivo da rodada

Consolidar a arquitetura local-first do Wayper depois das melhorias em corrida ativa, GPS/path, historico, sync, territorios, XP/conquistas, Perfil/Ranking, Home social, onboarding/permissoes, compartilhamento e diagnostico.

Este documento nao substitui os demais arquivos em `/docs`; ele resume o estado atual e aponta as decisoes que futuras alteracoes devem preservar.

## Escopo implementado

- Corrida ativa com estado canonico local em `wayper:activeRun:v2`.
- Recovery, conflitos e migracao centralizados em `runRecoveryService`.
- Checkpoints periodicos e de borda por `runAutoSaveService`.
- Pipeline de GPS/path em `src/services/tracking`, com `rawPath`, `trustedPath`, `renderPath` e `segments`.
- Notificacao Android persistente para corrida ativa, com pausar/retomar pelo fluxo oficial.
- Historico e detalhes offline pela chave local `runs`.
- Sync idempotente de runs por `sync.js` e `runSyncQueueService`.
- Repositories/facades local-first por dominio.
- Territorios locais em `wayper_territories_v1`.
- XP/conquistas locais em repositories dedicados.
- Perfil/Ranking com fontes explicitas `remote`, `cache`, `local`, `empty` e `demo`.
- Home principal social, usando `socialHomeRepository`.
- Onboarding, permissoes e estados reutilizaveis.
- Compartilhamento por `RunShareModal`: `Imagem` e `Tracado PNG`.
- Diagnostico local em `Configuracoes > Diagnostico`, com ZIP ampliado e coordenadas mascaradas por padrao.

## Decisoes principais

- O codigo atual na branch `develop` e a fonte principal; docs registram e explicam o estado real.
- Firestore continua existindo como remoto, cacheavel ou destino posterior, mas nao e dependencia obrigatoria dos fluxos locais ja consolidados.
- `activeRunTrackingService` / `activeRunState` sao a fonte da corrida ativa.
- `FINISHING` nao volta como corrida ativa.
- A fonte oficial de historico finalizado e `runs`, acessada por `RunRepository` e `sync.js`.
- Sync de runs nao usa fila paralela; ele parte da copia local e preserva `localRunId`/`remoteRunId`.
- `runService.js`, `locationService`, `zonesStorage`, `zoneService`, `xpService` e `MedalsWidget` seguem como legado/documentados, nao como base nova.
- SQLite nao foi adotado; so deve entrar apos medicao real de volume, parse e custo de rotas/historico.
- Home e social. Dashboard pessoal fica em `Dashboard`, `Perfil` ou resumo dedicado.
- Stories de corrida sao locais em `wayper_run_stories_v1` e ficam `PENDING_SYNC`; upload remoto ainda e futuro.
- Demo/mock so aparece com origem explicita e nunca como dado real.
- Copiar imagem nao aparece no compartilhamento enquanto clipboard de imagem nao for confiavel no build/plataforma.

## Arquitetura atual

| Dominio | Fonte atual | Observacao |
| --- | --- | --- |
| Corrida ativa | `activeRunTrackingService` / `activeRunState` | Estado canonico em `wayper:activeRun:v2`. |
| Recovery | `runRecoveryService` | Decide entre canonico e legado; impede finalizada voltar como ativa. |
| Autosave | `runAutoSaveService` | Checkpoints periodicos, AppState, erro recuperavel e pre-finish. |
| GPS/path | `src/services/tracking` | Classificacao, distancia, render path e segmentos. |
| Notificacao | `runNotificationService` + modulo nativo Android | Pausar/retomar; finalizar permanece no app. |
| Historico | `RunRepository` + `sync.js` | Chave local `runs`. |
| Sync de runs | `runSyncQueueService` + `sync.syncRunsToFirestore()` | Idempotente, com lock contra concorrencia. |
| Territorio | `TerritoryRepository` + `territoryStorageService` | Storage local atual, sync remoto separado. |
| XP/conquistas | `ProgressionRepository` / `AchievementRepository` | Idempotente por corrida/evento. |
| Perfil | `UserProfileRepository` + `profileStats` | Cache/local + remoto best effort. |
| Ranking | `RankingRepository` | Origem explicita. |
| Home social | `socialHomeRepository` | Stories/feed/amigos/corrida ativa sem Firestore obrigatorio. |
| Compartilhamento | `RunShareModal` e helpers em `src/utils/share` | Imagem, trace PNG, story local. |
| Diagnostico | `localDiagnosticsService` e export ZIP | Funciona offline e sanitiza dados. |

## Fontes de verdade

- Corrida ativa: `wayper:activeRun:v2`.
- Corrida finalizada: `runs`.
- Sync de runs: `runs` + `sync.js` + `runSyncQueueService`.
- Territorios atuais: `wayper_territories_v1`.
- Eventos territoriais: `wayper_territory_events_v1`.
- Leaderboards territoriais: `wayper_territory_leaderboards_v1`.
- XP/progresso: `wayper_user_progress_v1` e `wayper_xp_events_v1`.
- Conquistas: `wayper_achievements_v1` e `wayper_achievement_progress_v1`.
- Stories de corrida: `wayper_run_stories_v1`.
- Feed social cacheado: `wayper_activity_feed_cache_v1`.
- Perfil cache/local: `wayper_profile_v3`.
- Ranking cacheado: `wayper:rankingCache:v1:*`.
- Onboarding: `wayper:onboarding:v1:completed`.
- Diagnostico/logs: `wayper-diagnostics` e `wayper:diagnosticLogs:v1`.

## Storages legados

- `wayper_active_offline_run_v1`: checkpoint legado/compatibilidade da corrida ativa.
- `wayper_active_run_v1`: estado ativo antigo.
- `wayper_unsynced_runs_v2`: fila antiga de `runService.js`.
- `wayper_runs_cache_v2`: cache antigo de `runService.js`.
- `zones` e `@wayper_zones`: zonas antigas; usar apenas em migracao/compatibilidade explicita.
- `medals` e `@wayper:medals_awarded_v1`: medalhas visuais antigas, nao progresso real.

## Fluxos principais

- Onboarding informa; nao pede permissoes nativas cedo.
- Foreground location e obrigatoria para iniciar/retomar corrida.
- Background location e notificacao sao limitantes: devem ser explicadas, mas a negativa nao quebra o app inteiro.
- Iniciar corrida deve dar feedback imediato e bloquear duplo clique.
- Pausar/retomar pelo app ou notificacao passa pelo mesmo fluxo oficial.
- Finalizar salva localmente antes de depender de remoto.
- Historico/detalhe abrem offline e preferem copia local.
- Corrida por zonas preserva area, geometria, `zoneCoords`, resumo territorial, eventos e celulas quando a captura local existe.
- Corrida livre nao recebe territorio falso.
- Compartilhar `Imagem` ou `Tracado PNG` usa arquivos locais; baixar pede permissao de midia apenas no clique.
- Adicionar ao story cria story local `PENDING_SYNC` e nao publica remoto silenciosamente.
- Diagnostico/export deve funcionar sem Firestore, Sentry ou upload.

## Continuidade via Obsidian

Daqui para frente, toda alteracao relevante no Wayper deve manter codigo e Markdown sincronizados. O codigo em `develop` continua sendo a fonte do que esta implementado; os docs/Obsidian registram memoria, intencao, decisoes, bugs, ideias, propostas, riscos e proximos caminhos.

Novas ideias geradas durante uma rodada devem ser registradas em `docs/16-ideias-de-melhoria.md` como `AGUARDANDO_VALIDAÇÃO_EDU`, sem implementacao automatica. Propostas com escopo de proxima tarefa devem ficar em `docs/17-propostas-pendentes.md` ate Eduardo aprovar, rejeitar ou adiar. Ideias maiores ou dependentes de backend/sync remoto/validacao real devem ficar em `docs/wayper/12-ideias-futuras.md`.

Codex pode sugerir, registrar e organizar. Eduardo decide o que entra na proxima rodada.

## Validacoes realizadas

Ultima rodada reportada:

- `npm test -- --runInBand`: 49 suites / 428 testes.
- `git diff --check`: passou, com warnings LF/CRLF conhecidos quando aplicavel.
- `.\gradlew.bat :app:compileDevDebugKotlin --console=plain`: passou.
- Checagem estatica simples de imports relativos: 234 arquivos verificados.
- `lint`, `typecheck`, `test:ci` e `validate` nao existem no `package.json`.

## Riscos pendentes

- Validacao real em aparelho fisico Android/dev/release para GPS, background, notificacao, recovery, share e export.
- Fabricantes com economia agressiva de bateria podem matar o processo mesmo com foreground service.
- Feed/Friends/Groups ainda possuem trechos Firestore-first, incluindo componentes de grupo como `CreateGroupModal`.
- Upload/sync remoto de stories ainda nao existe.
- Sync remoto de XP/conquistas ainda nao existe.
- Sync territorial remoto completo/social ainda e futuro.
- AsyncStorage pode pesar com historico/rotas muito longos; SQLite depende de medicao real.
- Servicos legados ainda existem e nao devem ser reativados como fonte nova.
- `console.*` legado ainda existe fora dos fluxos criticos.
- Source maps/Sentry e assinatura Android release real dependem de credenciais e validacao autenticada.

## Proximos passos recomendados

1. Executar checklist Android real em aparelho fisico com build dev e release.
2. Validar background/tela bloqueada com economia de bateria ligada/desligada.
3. Fechar assinatura release real e source maps autenticados antes de tratar APK como publicavel.
4. Desacoplar Feed/Friends/Groups de chamadas Firestore-first por repositories, sem quebrar o social atual.
5. Implementar sync remoto de stories, XP/conquistas e territorios apenas depois de definir contratos e testes.
6. Medir volume real de `runs`, rota e diagnostico antes de decidir SQLite.
7. Manter docs e ADRs atualizados a cada mudanca de contrato.

## Checklist manual final

- [ ] Abrir app novo e concluir onboarding.
- [ ] Negar/permtir foreground location e validar bloqueio correto de corrida.
- [ ] Negar background/notification e validar aviso de limitacao, sem loop de prompt.
- [ ] Iniciar corrida livre offline, pausar, retomar e finalizar.
- [ ] Bloquear tela e voltar pelo app/notificacao em aparelho fisico.
- [ ] Matar app durante corrida e validar recovery.
- [ ] Finalizar offline e confirmar corrida no historico como `PENDING_SYNC`.
- [ ] Voltar internet e confirmar sync sem duplicata.
- [ ] Fazer corrida por zonas e confirmar territorio local real.
- [ ] Abrir historico/detalhe offline.
- [ ] Abrir Home social sem Firestore e validar local/cache/vazio honesto.
- [ ] Adicionar corrida ao story e confirmar `PENDING_SYNC`.
- [ ] Compartilhar `Imagem` e `Tracado PNG`; baixar pede midia apenas no clique.
- [ ] Abrir Perfil/Ranking offline/cache/local e confirmar origem explicita.
- [ ] Exportar ZIP em `Configuracoes > Diagnostico` e confirmar dados mascarados.

## Instrucoes para IA/Codex

- Comece em `develop`, rode `git status` e leia codigo antes de editar docs.
- Procure implementacao existente antes de criar service, hook, repository ou componente.
- Complete/refatore o existente; nao crie arquitetura paralela para parecer mais limpo.
- Preserve local-first: Firestore e remoto/best effort nos fluxos ja consolidados.
- Nao reative `runService.js`, `zones` legado, `xpService` ou `MedalsWidget` como fonte oficial.
- Nao documente background como 100% validado sem teste fisico.
- Nao documente story/XP/territorio como sincronizados remotamente enquanto isso nao existir.
- Nao mostre demo/mock como dado real.
- Atualize docs/ADRs quando mudar contrato de dados, arquitetura, permissao, sync, diagnostico ou UX critica.
- Antes de fechar rodada, rode `npm test -- --runInBand` e `git diff --check`.

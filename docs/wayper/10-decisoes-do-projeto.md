# Decisões do projeto

**Nota de precedência (2026-07-24):** decisões históricas permanecem como memória,
mas as decisões vigentes de produto estão em
`../product/10-decisoes-aprovadas.md` e os ADRs transversais em
`../architecture/adrs-direcao-oficial.md`.

## Como usar

Este arquivo registra decisões importantes da Wayper.

Toda mudança relevante de produto, arquitetura, Firestore, GPS, território, XP, ranking ou fluxo deve ser registrada aqui. Ideias podem começar como propostas, mas só viram decisão oficial quando movidas para "Decisões aprovadas".

## Decisões aprovadas

### A documentação oficial fica em `docs/wayper` — superada em 2026-07-24

Status: superada.

Decisão:

- A fonte implementada é o código de `develop`; `docs/wayper` é memória detalhada.
- A ordem completa está em `../00-fontes-do-projeto.md`.

Motivo:

- Preservar memória sem fazer documentação antiga vencer o comportamento real.

### O MVP deve validar caminhada/corrida com conquista de território

Status: aprovada.

Decisão:

- O primeiro MVP deve focar no ciclo de atividade real com GPS, rota, XP, resumo e conquista territorial simples.

Motivo:

- Esse é o núcleo diferencial da Wayper.

### Clans ficam fora do MVP

Status: aprovada.

Decisão:

- Clans serão tratados como ideia futura.

Motivo:

- Clans exigem ranking, convite, moderação, agregados e regras de grupo.

### Território do MVP é progresso individual

Status: em revisão por divergência.

Decisão:

- O território no MVP representa progresso individual derivado de atividades válidas.
- O MVP não define posse global, perda de território, disputa em tempo real ou controle compartilhado de áreas.

Situação atual:

- o código contém captura competitiva, defesa, roubo e líderes;
- a nova visão admite competição territorial, mas não aprova silenciosamente a
  fórmula atual;
- preservar o comportamento enquanto a regra final é auditada; não expandir ou
  remover sem decisão e rollback.

Motivo:

- Reduz complexidade de GPS, mapa, Firestore, ranking e anti-cheat.
- Mantém o foco na validação do ciclo principal: atividade real, rota, XP, resumo e conquista visível.

### Corrida ativa deve ser offline-first

Status: aprovada.

Decisão:

- Durante a corrida, a fonte principal de verdade é o armazenamento local do app.
- GPS, rota, tempo, pausa, retomada e finalização não devem depender de Firestore ou conexão ativa.
- Firestore deve receber a corrida somente depois que ela estiver salva localmente.
- Corridas finalizadas sem sincronização remota devem aparecer no histórico com status pendente.
- Ao reabrir o app, uma corrida ativa ou finalizada ainda não salva deve ser recuperada a partir do estado local.

Motivo:

- Um app de corrida não pode perder atividade real por oscilação de internet.
- A coleta GPS funciona sem internet e deve permanecer desacoplada do backend durante a atividade.
- A sincronização posterior reduz custo, falhas e acoplamento com Firestore.

### Fonte de verdade canonica da corrida ativa

Status: aprovada.

Contexto:

- O app mantinha dois estados locais para corrida ativa: `wayper:activeRun:v2` e `wayper_active_offline_run_v1`.
- Essa duplicidade podia fazer uma corrida finalizada voltar como ativa, recuperar snapshot antigo ou duplicar envio para a fila de sync.

Decisao:

- `activeRunTrackingService` / `activeRunState` sao a fonte de verdade canonica da corrida ativa.
- `runOfflineStorageService` continua existindo como checkpoint legado, compatibilidade e rascunho final temporario.
- `runRecoveryService` e a unica camada que decide entre canonico e legado.
- Legado vivo deve ser migrado para o snapshot canonico antes de ser aplicado na UI.
- Corrida finalizada ou pendente de sync nunca deve ser restaurada como ativa.

Motivo:

- Evitar ambiguidade pratica entre storages locais.
- Preservar compatibilidade com corridas locais antigas sem reimplementar o sistema de corrida.
- Manter a corrida ativa funcionando offline e sem dependencia obrigatoria de Firestore.

Impactos:

- GPS: path, rawPath, renderPath e segments passam pelo snapshot canonico.
- Mapa: `MapScreen` consome snapshot consolidado em vez de decidir entre storages.
- Firestore: continua sendo destino de sync posterior.
- Performance: AsyncStorage segue aceitavel nesta etapa; SQLite fica pendente de medicao real.
- Experiencia do usuario: UX principal nao muda, mas recovery fica deterministico.

### Fila de sync de corridas finalizadas deve ser local-first e idempotente

Status: aprovada.

Contexto:

- Corridas finalizadas ja ficam na chave local `runs`, mas podem ser salvas offline, falhar no Firestore ou passar por retry depois de reabrir o app.
- Uma fila paralela para runs aumentaria risco de duplicacao e divergencia entre historico, detalhes e Firestore.

Decisao:

- A fila oficial de sync de runs finalizadas parte de `sync.loadLocalRunHistory()` e atualiza a mesma copia por `sync.saveLocalRun()`.
- `runSyncQueueService` permanece como wrapper de enfileiramento, sem criar storage proprio.
- `remoteRunId` e a chave remota quando existir; sem ele, `localRunId` e usado como chave idempotente e vai para o payload remoto.
- Antes de criar documento novo, o app pode buscar remoto por `localRunId`.
- Sync de runs e sync de territorios continuam responsabilidades separadas.

Impactos:

- Historico: corridas `PENDING_SYNC`, `SYNC_FAILED`, `LOCAL_ONLY` e `SYNCED` continuam visiveis.
- Detalhes: a copia local completa continua preferida antes/depois do sync.
- Firestore: falhas nao apagam local e retry nao deve duplicar documento.
- Territorio: corrida por zonas preserva dados existentes; falha de territorio nao apaga corrida.
- Performance: rota local segue em AsyncStorage; se volume crescer, avaliar SQLite sem mudar a API das telas.

### Camada local-first incremental por repositories

Status: aprovada.

Contexto:

- Corrida ativa, historico e sync de runs ja estavam protegidos, mas telas de perfil/ranking e alguns fluxos ainda chamavam Firestore diretamente.
- Uma migracao ampla para uma nova arquitetura poderia duplicar storage, reativar legado ou quebrar fluxo de corrida.

Decisao:

- Introduzir repositories/facades finos por dominio, reaproveitando services oficiais.
- `RunRepository` chama `sync.js`; `RunSyncQueueRepository` chama `runSyncQueueService`/`sync.js`.
- `TerritoryRepository` usa storage local atual de territorio e trata zones legado explicitamente.
- `UserProfileRepository` protege perfil com cache/local.
- `RankingRepository` separa remoto, cache, local, demo e vazio.
- `LocalMetadataRepository` e `storageMigrationService` registram schemaVersion e storages legados sem apagar dados.
- SQLite nao entra agora.

Motivo:

- Reduzir Firestore direto nas telas com risco baixo.
- Preservar a fonte local oficial de runs e a fonte canonica da corrida ativa.
- Preparar sync futuro sem criar arquitetura paralela.

Impactos:

- GPS: sem mudanca.
- Mapa: sem mudanca estrutural; zonas legadas continuam leitura explicita.
- Firestore: continua em services/repositories, nao como dependencia direta das telas adaptadas.
- Performance: AsyncStorage continua; SQLite depende de medicao futura.
- Experiencia do usuario: historico/detalhe seguem offline; perfil/ranking falham de forma mais controlada.

### Onboarding, permissoes e estados vazios local-first

Status: aprovada.

Contexto:

- Usuario novo/offline precisava entender Wayper sem cair em prompts repetidos ou telas vazias genericas.
- Permissao de localizacao foreground e essencial para corrida, mas background e notificacoes sao limitacoes operacionais.
- O app nao pode depender de Firestore para abrir as principais areas nem mostrar demo/mock como dado real.

Decisao:

- `src/services/permissions.js` e a facade oficial de permissoes.
- Onboarding usa `wayper:onboarding:v1:completed`, informa antes de pedir e nao solicita permissao nativa.
- Localizacao foreground bloqueia inicio/retomada quando negada.
- Background location e notificacoes devem ser explicadas antes de pedir; se negadas, corrida fica limitada e o usuario recebe orientacao.
- Estados vazios/erro/offline/permissao devem reutilizar `src/components/states` quando possivel.

Motivo:

- Reduzir risco de loops de permissao e dead-ends.
- Manter corrida ativa e dados locais como fonte segura.
- Melhorar a experiencia de usuario novo sem criar arquitetura paralela.

Impactos:

- Mapa: muda apenas gating/copy/permissao, sem reimplementar GPS/path/sync.
- Home/Historico/Perfil/Ranking/Dashboard/Detalhe: estados vazios passam a ser explicitos e acionaveis.
- Firestore: segue melhor esforco; falha remota vira local/cache/vazio.
- Design: placeholder de avatar deve ser local por iniciais/icone, sem URL mock como avatar real.

## Decisões pendentes

### Estratégia final de território

Status: pendente.

Opções:

- Células de mapa.
- Buffer de rota.
- Zonas predefinidas.
- Modelo híbrido.

Impactos:

- Performance do mapa.
- Custo do Firestore.
- Clareza para o usuário.
- Complexidade de validação.

### Estrutura persistida de território no MVP

Status: pendente.

Opções:

- Salvar apenas resumo territorial na atividade.
- Criar `territoryClaims` para conquistas individuais.
- Criar entidades de território compartilhado somente em fase futura.

Impactos:

- Custo de escrita.
- Facilidade de exibir histórico.
- Migração para disputa futura.
- Complexidade de auditoria.

### Precisão mínima oficial do GPS

Status: pendente.

Proposta inicial:

- Até 25 metros: aceitável.
- Entre 25 e 50 metros: cautela.
- Acima de 50 metros: inválido para território.

Impactos:

- Justiça da conquista.
- Experiência em áreas urbanas densas.
- Quantidade de atividades parcialmente inválidas.

### Armazenamento de rotas

Status: pendente.

Opções:

- Subcoleção de pontos.
- Documento compactado.
- Rota simplificada.
- Armazenamento híbrido.

Impactos:

- Custo do Firestore.
- Performance do histórico.
- Capacidade de auditoria.

### Cálculo de agregados

Status: pendente.

Opções:

- No app.
- Em Cloud Functions.
- Híbrido.

Impactos:

- Consistência.
- Custo.
- Complexidade.
- Segurança contra manipulação.

## Sentry complementa diagnostico local

Status: aprovada.

Contexto:

- O app precisa observar crashes e falhas reais em production/staging.
- Logs NDJSON e export ZIP locais contem o detalhe necessario para GPS, background e recovery.
- Rota e dados pessoais nao devem sair do dispositivo por telemetria automatica.

Decisao:

- Usar `@sentry/react-native` para erros, breadcrumbs seguros, release, ambiente e tracing amostrado.
- Manter NDJSON/ZIP como diagnostico detalhado e independente.
- Sanitizar todo evento, breadcrumb e transacao antes do envio.
- Nao habilitar Session Replay, PII padrao ou log remoto de alta frequencia.

Impactos:

- GPS: nenhum ponto ou coordenada crua e enviado; apenas contagens/estado resumido.
- Mapa: falhas capturaveis podem ser monitoradas sem enviar geometria.
- Firestore: erros sao observados sem enviar payload de Auth ou snapshots completos.
- Performance: tracing de baixo volume; nenhum span por ponto GPS.
- Experiencia do usuario: ErrorBoundary continua acionando checkpoint local e mostra fallback existente.

## Decisões rejeitadas

### Ranking competitivo completo no MVP

Status: rejeitada para o MVP.

Motivo:

- Ranking competitivo exige validação mais forte de GPS e regras anti-fraude.
- Pode distorcer a validação inicial do produto.

### Disputa direta por posse de território no MVP

Status: rejeitada para o MVP.

Motivo:

- Aumenta complexidade de regras, moderação, sincronização e anti-cheat.
- O MVP deve validar conquista individual primeiro.

## Template para nova decisão

```md
### Título da decisão

Status: proposta | aprovada | rejeitada | pendente.

Contexto:

- Descreva o problema.

Decisão:

- Descreva a decisão.

Motivo:

- Explique por que essa opção foi escolhida.

Impactos:

- GPS:
- Mapa:
- Firestore:
- Performance:
- Experiência do usuário:
```

## Registro adicional aprovado

### Perfil e ranking local-first com source explicito

Status: aprovada.

Contexto:

- Perfil precisava refletir corridas, territorios, XP e conquistas locais reais mesmo com Firestore indisponivel.
- Ranking precisava abrir sem Firestore e diferenciar dado remoto, cache, local, vazio e demo.
- Demo/mock nao pode mascarar falha remota nem aparecer como ranking real.

Decisao:

- Consolidar estatisticas locais em `profileStats`, lendo `RunRepository`, `TerritoryRepository`, `ProgressionRepository` e `AchievementRepository`.
- `UserProfileRepository` mescla essa visao local no perfil local/cacheado.
- `RankingRepository` retorna sempre `source`: `remote`, `cache`, `local`, `empty` ou `demo`.
- Ranking local usa dados reais do proprio usuario e nao inventa oponentes.
- Cache remoto pode receber overlay da linha local do proprio usuario sem duplicar identidade.
- Upload de avatar por Storage e melhor esforco; falha preserva avatar local/cacheado.

Impactos:

- Perfil/ranking abrem offline ou com Firestore falhando.
- Corrida ativa e `FINISHING` nao entram em estatisticas finalizadas.
- Corridas pendentes/falhas de sync continuam contando como dado local real.
- SQLite continua pendente de medicao futura se volume local crescer.

### Home principal social local-first

Status: aprovada.

Contexto:

- `Inicio` e percebida como Home social, similar a apps de corrida com stories/feed/amigos.
- Uma implementacao anterior transformou a Home em dashboard pessoal; essa visao continua util, mas pertence a Dashboard/Perfil.
- Historico local, perfil/cache, feed e corrida ativa ja tinham fontes oficiais; a Home nao deve duplicar run/sync/GPS.
- Firestore indisponivel nao pode apagar a Home nem trocar dados reais por demo/mock.

Decisao:

- Criar `socialHomeRepository` como facade da Home social.
- `HomeScreen` consome `socialHomeRepository` e preserva drawer/`HomeHeader`.
- Fontes da Home social: `feedService`, `RunRepository`, `UserProfileRepository`, `activeRunTrackingService`, `wayper_run_stories_v1` e `wayper_activity_feed_cache_v1`.
- `feedService` roda na Home com `allowDemo=false`; demo/mock nao aparece como amigo, online fake, story ou atividade real.
- "Adicionar ao story" cria story local a partir de corrida finalizada real, com status `PENDING_SYNC`, sem enviar nada silenciosamente para remoto.
- A Home nao chama Firestore direto, nao reimplementa corrida ativa, nao recalcula GPS/path e nao cria storage paralelo de run/sync.
- Acao principal continua/retoma corrida preservada navegando para `Mapa`, ou abre o mapa para iniciar corrida.
- `homeDashboardRepository` permanece valido para Dashboard/Perfil, nao para a Home principal.

Impactos:

- Usuario novo ve estados vazios sociais uteis, nao cards pessoais falsos.
- Corridas ativas, pausadas, recuperando ou `FINISHING` nao viram story nem card finalizado.
- Story criado localmente aparece imediatamente e fica pendente de sync futura.
- Falha remota cai para cache/local/empty sem apagar stories ou feed cacheado.
- Dashboard pessoal segue acessivel fora da Home social.

### Compartilhamento de corridas local-first

Status: aprovada.

Contexto:

- Corridas finalizadas ja ficam disponiveis localmente em `runs`/`RunRepository`.
- O app precisa compartilhar imagem, baixar PNG e criar story local mesmo offline.
- O pipeline de corrida separa `rawPath` para diagnostico, `trustedPath` para metrica, `renderPath` para visual e `segments` para pausas/gaps.
- A Home social ja usa stories locais em `wayper_run_stories_v1` com `PENDING_SYNC`.

Decisao:

- `RunShareModal` e a superficie unica para compartilhar corrida finalizada.
- O modal separa `Imagem` e `Tracado PNG`.
- `Imagem` exporta card Wayper com mapa/rota, estatisticas salvas, modo livre/zonas e area real quando existir.
- `Tracado PNG` exporta PNG transparente apenas com rota ou poligono real de zona.
- Export visual usa `renderPath`/`segments` quando existirem e nao conecta pausas/gaps.
- Corrida por zonas so desenha poligono quando `zoneCoords` existir; sem poligono, o share nao inventa territorio.
- Baixar imagem/PNG pede permissao de midia somente no clique de download.
- Compartilhar nativo usa arquivo local temporario e nao depende de Firestore.
- Adicionar ao story cria item local `PENDING_SYNC` com `runSummary` seguro e `media` local opcional.
- `Copiar` nao aparece enquanto nao houver suporte confiavel para clipboard de imagem.

Impactos:

- GPS/path salvo nao e recalculado nem alterado.
- Historico/detalhe continuam usando `RunRepository` e dados locais.
- Home social passa a exibir a midia local do story quando ela existir.
- Firestore fica fora do caminho critico de compartilhar, baixar e adicionar story.
- Duplicata de story da mesma corrida e bloqueada pelo repository local.

### Territorios locais antes do sync remoto completo

Status: aprovada.

Contexto:

- Corrida por zonas precisava preservar captura real mesmo offline.
- `zones` e `@wayper_zones` eram legados e nao podiam virar storage novo.
- Sync territorial remoto social/completo ainda nao estava definido.

Decisao:

- Usar `TerritoryRepository`/`territoryStorageService` como facade/fonte local atual.
- Territorios ficam em `wayper_territories_v1`.
- Eventos ficam em `wayper_territory_events_v1`.
- Leaderboards/cache ficam em `wayper_territory_leaderboards_v1`.
- Corrida livre nao preserva territorio falso.
- Corrida por zonas preserva `area`, `areaM2`, `geometry`, `zoneCoords`, `territorySummary`, `territoryEvents` e `capturedCells` quando a captura local existe.
- Firestore e destino posterior/best effort e sync territorial segue separado do sync de runs.

Impactos:

- Historico/detalhe continuam abrindo com dados territoriais locais.
- Falha remota nao apaga territorio local.
- SQLite segue decisao futura apos medicao.

### XP e conquistas locais antes do sync remoto

Status: aprovada.

Contexto:

- `xpService`/`MedalsWidget` eram base legada/visual e nao garantiam progresso offline nem idempotencia.
- Perfil precisava exibir progresso local real sem Firestore obrigatorio.

Decisao:

- `ProgressionRepository` e fonte de XP/nivel/progresso local em `wayper_user_progress_v1` e `wayper_xp_events_v1`.
- `AchievementRepository` e fonte de conquistas/progresso em `wayper_achievements_v1` e `wayper_achievement_progress_v1`.
- XP so entra apos corrida finalizada salva localmente.
- Eventos de XP sao idempotentes por corrida/tipo.
- Sync remoto de XP/conquistas fica futuro.

Impactos:

- Perfil/Dashboard podem abrir offline com XP e conquistas locais.
- Corrida ativa, `FINISHING`, invalida, descartada ou suspeita nao gera XP.
- `xpService`, `MedalsWidget`, `medals` e `@wayper:medals_awarded_v1` seguem legado, nao fonte oficial.

### Diagnostico local seguro

Status: aprovada.

Contexto:

- Bugs reais de corrida ativa, GPS, background, notificacao, share, sync, territorio e ranking precisam de evidencia local em aparelho fisico.
- Firestore, Sentry ou adb nao podem ser requisitos para diagnosticar o app.

Decisao:

- Centralizar em `Configuracoes > Diagnostico`.
- Usar `localDiagnosticsService`, `logStorageService`, `runDiagnosticsService`, `diagnosticExportService` e `logger.js`.
- Export ZIP inclui NDJSON, snapshots leves, manifest e `reports/*`.
- Coordenadas exatas ficam desligadas por padrao.
- `rawPath` completo, tokens, emails completos, imagens privadas e payloads de terceiros nao entram no resumo padrao.

Impactos:

- Diagnostico abre offline e sem Firestore obrigatorio.
- Sentry complementa, mas nao substitui o ZIP/NDJSON local.
- Novos dominios local-first devem registrar resumo/logs ali antes de criar debug paralelo.

### Rodada local-first consolidada na documentacao

Status: aprovada.

Contexto:

- A rodada consolidou corrida ativa, GPS/path, historico, sync, territorios, XP/conquistas, Perfil/Ranking, Home social, onboarding/permissoes, compartilhamento e diagnostico.
- Parte da documentacao antiga ainda parecia Firestore-first ou tratava itens avancados como "a fazer".

Decisao:

- Criar `docs/24-resumo-rodada-local-first.md`.
- Atualizar docs principais para declarar Firestore como remoto/best effort nos fluxos consolidados.
- Registrar riscos: validacao fisica Android, sync remoto futuro de stories/XP/territorio, AsyncStorage a medir, Feed/Friends/Groups ainda Firestore-first e servicos legados.

Impactos:

- Futuras IAs/Codex devem ler codigo develop e docs antes de implementar.
- Nao documentar background como 100% validado sem teste fisico.
- Nao documentar sync remoto de stories/XP/territorio como pronto enquanto for futuro.
- Nao criar arquitetura paralela nem reativar legado como fonte nova.

## Documentos relacionados

- [[00-index]]
- [[02-mvp]]
- [[03-mecanica-territorios]]
- [[08-firebase-firestore]]
- [[09-arquitetura-tecnica]]


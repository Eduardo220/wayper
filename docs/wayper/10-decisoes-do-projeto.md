# Decisões do projeto

## Como usar

Este arquivo registra decisões importantes da Wayper.

Toda mudança relevante de produto, arquitetura, Firestore, GPS, território, XP, ranking ou fluxo deve ser registrada aqui. Ideias podem começar como propostas, mas só viram decisão oficial quando movidas para "Decisões aprovadas".

## Decisões aprovadas

### A documentação oficial fica em `docs/wayper`

Status: aprovada.

Decisão:

- `docs/wayper` é a fonte de verdade do projeto.
- Mudanças importantes devem atualizar a documentação correspondente.

Motivo:

- Evitar regras espalhadas entre conversas, código e documentos antigos.

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

Status: aprovada.

Decisão:

- O território no MVP representa progresso individual derivado de atividades válidas.
- O MVP não define posse global, perda de território, disputa em tempo real ou controle compartilhado de áreas.

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

## Documentos relacionados

- [[00-index]]
- [[02-mvp]]
- [[03-mecanica-territorios]]
- [[08-firebase-firestore]]
- [[09-arquitetura-tecnica]]


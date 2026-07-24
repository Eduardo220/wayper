# Guia de Testes

## Objetivo

Garantir que as partes críticas do Wayper funcionem antes de mexer em produção. Que conceito revolucionário: testar antes de quebrar.

## Comando base

```bash
npm test
```

Para validacao completa local antes de fechar uma mudanca grande:

```bash
npm test -- --runInBand
```

## Validacao consolidada da rodada local-first

Ultima rodada reportada em 2026-06-19:

```bash
npm test -- --runInBand
git diff --check
.\gradlew.bat :app:compileDevDebugKotlin --console=plain
```

Resultados reportados:

- `npm test -- --runInBand`: 49 suites / 428 testes aprovados.
- `git diff --check`: aprovado, com warnings LF/CRLF conhecidos quando aplicavel.
- `compileDevDebugKotlin`: aprovado.
- Checagem estatica simples de imports relativos: 234 arquivos verificados.
- `lint`, `typecheck`, `test:ci` e `validate` nao existem no `package.json`; nao cite esses scripts como executados enquanto nao forem adicionados.

Mesmo com os testes passando, GPS/background/notificacao/recovery/share precisam de validacao fisica Android dev/release.

## Testes unitários prioritários

### Corrida

- Cálculo de distância.
- Cálculo de duração.
- Cálculo de ritmo.
- Cálculo de velocidade.
- Validação de corrida mínima.
- Filtro de pontos GPS inválidos.

### Zonas

- Conversão de rota em área.
- Cálculo de área.
- Interseção/sobreposição.
- União de zonas.
- Validação de geometria.

### Ranking

- Ordenação por área.
- Ordenação por zonas.
- Ordenação por distância.
- Empate.
- Exclusão de corridas inválidas.

### Onboarding, permissoes e estados vazios

- `normalizePermissionStatus` cobre `granted`, `denied`, `blocked`, `limited`, `unavailable`, `unknown` e `checking`.
- Foreground location concedida permite iniciar corrida; negada bloqueia com mensagem clara.
- Background location negada mostra limitacao, sem prometer tela bloqueada perfeita.
- Notificacao negada nao quebra corrida.
- `canAskAgain=false` mostra abrir configuracoes.
- Educacao de permissao aparece uma vez e nao dispara request nativo em loop.
- Onboarding aparece para usuario novo, pode ser concluido e nao reaparece.
- Onboarding nao pede midia/galeria cedo demais.
- Estados vazios de Home, Historico, Ranking, Perfil, Mapa, compartilhamento e detalhe nao usam mock como dado real.
- Firestore falhando cai para local/cache/vazio e nao deixa spinner infinito.

## Testes de integração

- Login com Firebase.
- Criação de documento de usuário.
- Salvamento de corrida.
- Leitura de histórico.
- Atualização de estatísticas.
- Carregamento de ranking.

## Testes manuais obrigatórios

### Emulador

- [ ] Abrir app.
- [ ] Login/cadastro.
- [ ] Permissão de localização.
- [ ] Mapa carregando.
- [ ] Iniciar corrida simulada.
- [ ] Finalizar corrida.
- [ ] Conferir histórico.

### Celular físico

- [ ] Instalar build dev.
- [ ] Testar localização real.
- [ ] Testar rota curta.
- [ ] Testar perda de internet.
- [ ] Testar app em segundo plano, se suportado.
- [ ] Testar finalização e persistência.

### Rua

- [ ] Iniciar corrida em ambiente real.
- [ ] Confirmar precisão do GPS.
- [ ] Confirmar desenho da rota.
- [ ] Finalizar corrida.
- [ ] Conferir zona/estatística gerada.

### GPS/path em rua

- [ ] Caminhar/correr em linha reta e comparar distancia aproximada.
- [ ] Fazer curva em esquina e validar que a linha nao corta quadra de forma agressiva.
- [ ] Dar volta em uma quadra e validar que o formato fecha de maneira plausivel.
- [ ] Parar por 30 a 60 segundos e confirmar que jitter parado nao infla distancia.
- [ ] Pausar, caminhar alguns metros, retomar e confirmar que o trecho pausado nao foi conectado.
- [ ] Bloquear tela durante parte do trajeto e validar que os pontos de background nao duplicam nem voltam no tempo.
- [ ] Passar por area com GPS ruim e confirmar que salto impossivel nao vira linha reta pela cidade.
- [ ] Finalizar offline e conferir que `rawPath`, `trustedPath`, `renderPath` e `segments` aparecem no historico local.
- [ ] Repetir em corrida livre e corrida por zonas.
- [ ] Abrir historico/replay/compartilhamento, se disponiveis, e conferir que pausas/gaps continuam separados.

### Finalizacao e diagnostico de emergencia

- [ ] Iniciar corrida livre e tocar no atalho `Diagnostico` do card `Wayper live`.
- [ ] Confirmar que o share sheet recebe um JSON leve com `light: true` e `fullExportDeferred: true`, sem pausar a corrida.
- [ ] Durante o export leve, tocar em `Finalizar` e confirmar que a corrida salva localmente, o resumo aparece e a UI nao fica presa em `EXPORTANDO`.
- [ ] Repetir em corrida por zonas e confirmar que o resumo/historico aparece antes da captura territorial pesada terminar.
- [ ] Em corrida por zonas, confirmar que um item salvo com captura pendente usa `territoryCaptureStatus: PENDING` e continua `PENDING_SYNC`.
- [ ] Abrir `Configuracoes > Diagnostico` depois da finalizacao e exportar o ZIP completo.
- [ ] Conferir nos logs a ordem `RUN_FINISH_LOCAL_MIN_SAVE_STARTED` -> `RUN_FINISH_LOCAL_MIN_SAVE_COMPLETED` -> `RUN_FINISH_UI_RELEASED` -> `RUN_FINISH_DEFERRED_TASKS_SCHEDULED`.
- [ ] Confirmar que `Iniciar Corrida` nao aparece enquanto `Finalizando...` esta ativo.
- [ ] Repetir offline/Firestore indisponivel e confirmar que save local, resumo e historico continuam funcionando.

## Cobertura automatizada de GPS/path

Os testes nao usam GPS real, MapLibre, Firebase real ou rede. Eles devem cobrir:

- Coordenadas invalidas, `0,0`, timestamp ausente, timestamp futuro, ponto antigo e ponto fora de ordem.
- Duplicatas foreground/background e lote de background recebido invertido.
- Accuracy ruim, velocidade impossivel, aceleracao alta, salto grande e jitter parado.
- Distancia apenas com `trustedPath`, sem somar durante `PAUSED` e sem conectar segmentos.
- Gap curto plausivel mantendo segmento; gap longo criando novo segmento.
- Preservacao de `rawPath`, `trustedPath`, `renderPath` e `segments` em save/recovery/sync.
- GeoJSON `LineString` para segmento unico e `MultiLineString` para multiplos segmentos.

## Historico e detalhes local-first

Checklist manual:

- [ ] Finalizar corrida online e abrir historico.
- [ ] Finalizar corrida offline e abrir historico sem religar internet.
- [ ] Abrir detalhes da corrida offline por item do historico.
- [ ] Voltar internet e confirmar que a corrida nao duplica apos sync.
- [ ] Simular sync falho e confirmar que a corrida segue visivel com status de falha.
- [ ] Abrir corrida livre e confirmar que nao aparece area falsa.
- [ ] Abrir corrida por zonas e confirmar area/territorio quando existirem.
- [ ] Conferir rota no detalhe usando pausas/gaps sem linha conectando trecho pausado.
- [ ] Matar app depois de finalizar e reabrir historico.
- [ ] Abrir detalhe por `localRunId` e por `remoteRunId`, quando disponiveis.

Cobertura automatizada esperada:

- Listagem local inclui `PENDING`, `FAILED`, `SYNCED` e `LOCAL_ONLY`.
- Listagem local ignora `RUNNING`, `PAUSED`, `RECOVERING` e `FINISHING`.
- Dedupe por `id`, `localRunId`, `remoteRunId`, `runId` e `legacyId`.
- Detalhe consegue buscar a corrida por qualquer id conhecido.
- `syncStatus`, `offlineStatus`, `remoteRunId`, path e `segments` sao preservados apos save/sync/retry.
- Firestore falhando nao apaga nem esconde a corrida local.

## Fila de sync local de corridas finalizadas

Checklist manual:

- [ ] Finalizar corrida online e confirmar que a corrida fica `SYNCED` com `remoteRunId`.
- [ ] Finalizar corrida offline e confirmar `PENDING_SYNC` no historico.
- [ ] Voltar internet e confirmar que a mesma corrida vira `SYNCED` sem duplicar.
- [ ] Simular Firestore falhando e confirmar `SYNC_FAILED` visivel no historico.
- [ ] Rodar retry e confirmar que usa o mesmo `remoteRunId`/`localRunId`.
- [ ] Abrir historico durante sync.
- [ ] Abrir detalhes durante sync.
- [ ] Matar app durante sync, reabrir e confirmar retomada da fila.
- [ ] Conferir que `trustedPath`, `renderPath`, `rawPath` e `segments` seguem no detalhe antes/depois do sync.
- [ ] Testar corrida livre e confirmar que o payload remoto nao inclui territorio falso.
- [ ] Testar corrida por zonas e confirmar `area`, `geometry`, `zoneCoords` e resumo territorial.
- [ ] Simular falha de territorio e confirmar que a corrida continua localmente visivel.

Cobertura automatizada esperada:

- Normalizacao de `PENDING_SYNC`, `SYNC_FAILED`, `LOCAL_ONLY` e status ausente.
- Offline nao chama Firestore.
- Retry nao cria documento diferente quando `remoteRunId` existe.
- Busca remota por `localRunId` antes de criar documento novo.
- Payload Firestore sem `undefined`, com `localRunId`, `remoteRunId`, modo, path e dados territoriais existentes.
- Corrida livre nao ganha `area`, `geometry` ou `zoneCoords` falsos no payload remoto.
- Lock impede dois syncs simultaneos.
- Sync antigo nao marca `SYNCED` se a copia local mudou durante o envio.
- Falha de Firestore preserva corrida local como `SYNC_FAILED`.

## Repositories local-first

Os testes de repositories nao usam Firebase real, rede real, GPS real nem MapLibre. Eles devem validar a arquitetura de acesso a dados sem recriar regras de dominio ja existentes em services oficiais.

Cobertura automatizada esperada:

- `RunRepository` lista pela fonte local oficial (`sync.loadLocalRunHistory()`), busca por `localRunId`/`remoteRunId`, salva sem perder `remoteRunId`, preserva `syncStatus`, path, `renderPath`, `trustedPath` e `segments`.
- `RunRepository` nao importa nem chama `runService.js` legado.
- `RunSyncQueueRepository` encapsula `runSyncQueueService`/`sync.js`, nao usa `wayper_unsynced_runs_v2` e nao cria fila paralela.
- `TerritoryRepository` le storage atual de territorios, preserva `geometry`, `zoneCoords` e `area`, trata storage vazio e separa `zones`/`@wayper_zones` como legado explicito.
- `UserProfileRepository` retorna cache/local quando Firestore falha, nao transforma erro remoto em quebra de tela e nao inventa mock como perfil real.
- `RankingRepository` diferencia `remote`, `cache`, `local`, `demo` e `empty`; Firestore falhando vira cache/estado vazio controlado.
- `storageMigrationService` roda uma vez, atualiza schemaVersion, marca storages legados e nao apaga dados.
- Telas adaptadas nao devem importar `firebase/firestore` diretamente quando houver repository/service correspondente.

Checklist manual adicional:

- [ ] Abrir o app com Firestore indisponivel e confirmar que home/perfil/ranking nao quebram.
- [ ] Abrir historico e detalhes offline.
- [ ] Confirmar que ranking sem dados reais mostra estado vazio/cache identificado, nao mock real.
- [ ] Confirmar que zonas legadas so aparecem onde o fluxo ainda chama leitura legada explicitamente.

## Home social local-first

Checklist manual:

- [ ] Abrir `Inicio` com internet e confirmar stories/feed reais ou cacheados quando existirem.
- [ ] Abrir `Inicio` sem internet/Firestore e confirmar que cache/local/vazio aparece sem quebrar.
- [ ] Abrir sem amigos e confirmar estado honesto, sem amigos fake.
- [ ] Abrir sem stories e confirmar estado vazio com acao para adicionar corrida.
- [ ] Abrir sem feed e confirmar estado vazio sem atividade demo.
- [ ] Confirmar que "online" so aparece quando ha presenca real/cacheada.
- [ ] Tocar em `Seu story` e abrir o seletor de corridas.
- [ ] Confirmar que o seletor lista minhas corridas finalizadas locais.
- [ ] Confirmar que corrida ativa/`FINISHING` nao aparece no seletor.
- [ ] Adicionar corrida finalizada ao story e confirmar story local `PENDING_SYNC`.
- [ ] Tentar adicionar a mesma corrida de novo e confirmar que nao duplica.
- [ ] Abrir story salvo localmente.
- [ ] Abrir card de corrida do feed; se for de outro usuario, abrir detalhe seguro/read-only.
- [ ] Testar corrida livre no feed sem territorio falso.
- [ ] Testar corrida por zonas no feed com area quando existir.
- [ ] Confirmar que Dashboard/Perfil ainda mostram estatisticas pessoais.
- [ ] Confirmar que a Home nao domina a tela com XP, estatisticas, territorio, ranking ou sync pessoal.
- [ ] Simular Firestore falhando e confirmar que cache/local nao e apagado.

Cobertura automatizada esperada:

- `socialHomeRepository` retorna `stories`, `friends`, `feedItems`, `myRecentRunsForStory`, `pendingStoryUploads`, `source` e estados vazios.
- `socialHomeRepository` usa `feedService` com `allowDemo=false`.
- Erro remoto retorna cache/local/vazio sem apagar cache.
- `wayper_run_stories_v1` salva story local com `PENDING_SYNC`.
- `wayper_activity_feed_cache_v1` preserva cache normalizado do feed.
- Corrida ativa/`FINISHING` nao aparece em `myRecentRunsForStory`.
- Corrida livre nao cria `territoryAreaM2` falso.
- Corrida por zonas preserva area real no resumo.
- Duplicata de story da mesma corrida nao cria novo registro sem opt-in.
- Amigos/feed `demo` ou `mock-*` nao passam como dado real.
- `feedService` nao injeta `DEV_MOCK_FRIENDS` sem opt-in explicito.
- `homeDashboardRepository` continua testado como base de dashboard pessoal, nao como fonte principal da Home.

## Compartilhamento de corridas

Checklist manual:

- [ ] Abrir detalhe de corrida livre finalizada local.
- [ ] Abrir `Compartilhar corrida` e confirmar as opcoes `Imagem` e `Tracado PNG`.
- [ ] Compartilhar `Imagem` e confirmar share sheet nativa com arquivo PNG.
- [ ] Baixar `Imagem` e confirmar que a permissao de midia aparece somente nesse clique.
- [ ] Compartilhar `Tracado PNG` e confirmar fundo transparente/sem card quando o app destino suportar transparencia.
- [ ] Baixar `Tracado PNG` e confirmar arquivo nao vazio.
- [ ] Confirmar que `Copiar` nao aparece enquanto clipboard de imagem nao for confiavel.
- [ ] Adicionar `Imagem` ao story e abrir Home para ver story local `PENDING_SYNC`.
- [ ] Tentar adicionar a mesma corrida novamente e confirmar que nao duplica.
- [ ] Testar corrida por zonas com area e `zoneCoords`, confirmando poligono real.
- [ ] Testar corrida por zonas sem `zoneCoords`, confirmando rota/metricas sem territorio inventado.
- [ ] Testar rota com pausa/gap e confirmar que o PNG nao conecta os trechos.
- [ ] Testar corrida sem rota suficiente e confirmar acao de `Tracado PNG` desabilitada/erro controlado.
- [ ] Negar permissao de midia e confirmar alerta controlado com alternativa de compartilhar.
- [ ] Cancelar share sheet e confirmar que nao aparece erro fatal.
- [ ] Repetir offline/Firestore indisponivel.

Cobertura automatizada esperada:

- `runTraceSource` prefere `segments` visuais quando existem.
- `runTraceSource` gera rota segmentada sem transformar path plano em ponte entre pausas.
- Corrida por zonas so vira poligono quando `zoneCoords` existe.
- Rota vazia falha com `TRACE_POINTS_INSUFFICIENT`.
- `socialHomeRepository.createRunStoryFromRun` cria story local `PENDING_SYNC` com `media` segura.
- Story nao carrega `rawPath`/debug/sync internals.
- Corrida `FINISHING` nao vira story.
- Duplicata da mesma corrida nao cria novo story.

## Perfil e ranking local-first

Checklist manual:

- [ ] Abrir Perfil sem internet/Firestore e confirmar que nome/avatar/cache local nao somem.
- [ ] Finalizar corrida offline e confirmar que Perfil soma corrida, distancia, duracao e XP local.
- [ ] Confirmar que corrida pendente de sync conta no Perfil e que `SYNC_FAILED` nao remove estatistica.
- [ ] Voltar internet, sincronizar e confirmar que a mesma corrida nao duplica total.
- [ ] Iniciar uma corrida e deixar ativa/pausada; confirmar que ela nao entra nas estatisticas finalizadas.
- [ ] Finalizar corrida por zonas com captura real e conferir area/zonas no Perfil.
- [ ] Finalizar corrida livre e confirmar que area/territorio nao aumentam artificialmente.
- [ ] Gerar XP/conquista e conferir Perfil e Dashboard com Firestore falhando.
- [ ] Abrir Ranking sem internet no modo Km, XP, Corridas e Area; confirmar `local`, `cache` ou `empty` honesto.
- [ ] Confirmar que Ranking local com apenas o usuario do aparelho nao inventa outros atletas.
- [ ] Confirmar que Ranking demo so aparece em fluxo dev/opt-in e com identificacao demo.
- [ ] Trocar usuario/logout quando possivel e confirmar que progresso/conquistas/ranking local nao misturam `userId`.
- [ ] Testar falha de upload de avatar e confirmar que o perfil local continua salvo sem apagar avatar/cache.

Cobertura automatizada esperada:

- `profileStats` calcula estatisticas por `RunRepository`, `TerritoryRepository`, `ProgressionRepository` e `AchievementRepository`.
- `profileStats` ignora corrida ativa/`FINISHING`, conta pendente de sync e deduplica local/remoto.
- `UserProfileRepository` retorna perfil local com estatisticas locais quando Firestore falha.
- `UserProfileRepository` nao grava avatar `file://` como avatar remoto quando Storage falha.
- `RankingRepository` retorna `remote`, `cache`, `local`, `empty` e `demo` explicitamente.
- `RankingRepository` usa XP local de `ProgressionRepository`, distancia local de `RunRepository` e area local de `TerritoryRepository`.
- Cache de ranking tem `updatedAt`/`cachedAt` e overlay local nao duplica o proprio usuario.
- Ranking demo nao aparece como fallback silencioso de erro remoto.

## Territorios e zonas local-first

Checklist manual:

- [ ] Iniciar corrida por zonas online e finalizar com captura valida.
- [ ] Conferir no resumo `area`, `areaM2`, `zoneCoords`, `geometry`, `territorySummary` e eventos quando houver.
- [ ] Abrir historico e detalhe da corrida por zonas sem depender do Firestore.
- [ ] Iniciar corrida por zonas offline, finalizar e confirmar que territorio local fica salvo.
- [ ] Abrir mapa sem Firestore funcional e confirmar que territorios locais aparecem.
- [ ] Abrir dashboard/home sem Firestore e confirmar fallback local/cacheado ou vazio controlado.
- [ ] Abrir feed territorial/home sem internet e confirmar que nao aparece atividade demo como real.
- [ ] Abrir leaderboard territorial sem internet e confirmar cache/local/vazio controlado.
- [ ] Voltar internet e confirmar que corrida e territorio nao duplicam.
- [ ] Testar corrida livre e confirmar que nao aparece area, geometria, coords ou resumo territorial falso.
- [ ] Testar com storage legado `zones`/`@wayper_zones` e confirmar que so entra por migracao/compatibilidade explicita.

Cobertura automatizada esperada:

- `TerritoryRepository` lista/salva/atualiza territorios locais atuais e nao usa `zones` como storage novo.
- Normalizacao preserva `area`, `areaM2`, `geometry`, `zoneCoords`, `localId`, `remoteId`, `runLocalId`, `syncStatus` e `offlineStatus`.
- Eventos territoriais listam/salvam com identidade local e status de sync.
- Leaderboard cacheado lista/salva por `wayper_territory_leaderboards_v1`.
- Migracao de legado roda uma vez, nao apaga dados e nao duplica territories.
- Captura por zonas offline salva territorio/eventos locais e agenda sync futuro.
- Mesma corrida nao deve duplicar captura territorial.
- Corrida livre nao gera territorio e `saveLocalRun()` remove campos territoriais falsos localmente e no payload remoto.
- Corrida por zonas preserva resumo territorial e eventos no historico local.
- Feed/home usa territorios locais atuais quando Firestore falha e storage vazio retorna lista vazia controlada.

## XP, progresso e conquistas local-first

Checklist manual:

- [ ] Finalizar a primeira corrida livre valida e conferir XP, nivel e conquista "Primeira corrida".
- [ ] Finalizar segunda corrida e confirmar que XP soma sem duplicar a primeira.
- [ ] Matar o app e reabrir, confirmando que XP/progresso/conquistas foram preservados.
- [ ] Finalizar corrida offline e confirmar progresso local sem Firestore.
- [ ] Voltar internet e confirmar que sync de runs nao duplica XP.
- [ ] Finalizar corrida por zonas com captura valida e confirmar XP territorial.
- [ ] Finalizar corrida livre com payload sem territorio e confirmar que nao aparece XP territorial falso.
- [ ] Abrir perfil e dashboard com Firestore falhando e confirmar progresso local.
- [ ] Limpar storage em dev e confirmar estado inicial controlado.

Cobertura automatizada esperada:

- `ProgressionRepository` cria progresso inicial, calcula nivel, salva progresso e preserva `syncStatus`.
- Corrida finalizada valida gera eventos de XP locais com `localId`, `sourceRunId` e `type`.
- Corrida ativa, `FINISHING`, invalida ou curta nao gera XP.
- Mesma corrida/retry de sync nao duplica XP.
- Corrida livre nao recebe XP territorial.
- Corrida por zonas recebe XP territorial apenas com dados validos.
- Eventos corrompidos/storage vazio retornam estado controlado sem quebrar o app.
- `AchievementRepository` lista catalogo, salva progresso parcial, desbloqueia conquistas e nao duplica desbloqueios.
- Conquistas iniciais cobrem primeira corrida, distancia acumulada, primeira corrida por zonas, primeira area conquistada, 3 corridas e 30 minutos totais.
- Perfil/dashboard conseguem consumir progresso local sem Firebase real, rede real, GPS real ou MapLibre.

## Diagnostico local e export

Checklist manual:

- [ ] Abrir `Configuracoes > Diagnostico` sem corrida ativa.
- [ ] Iniciar corrida e conferir `status`, `localRunId`, elapsed, distancia, path counts, segments e notification/background.
- [ ] Bloquear tela e voltar pelo app/notificacao, conferindo lifecycle/background.
- [ ] Gerar pontos GPS e conferir raw/accepted/rejected, motivos de descarte e gaps.
- [ ] Pausar/retomar e conferir segments.
- [ ] Finalizar offline e conferir sync pendente.
- [ ] Criar story e conferir pending story sync.
- [ ] Compartilhar imagem/PNG e conferir ultimo export em `Compartilhamento`.
- [ ] Negar permissoes e conferir resumo normalizado.
- [ ] Copiar resumo tecnico.
- [ ] Forcar flush de logs.
- [ ] Exportar ZIP e abrir `localDiagnostics-summary.json`.
- [ ] Validar que coordenadas estao mascaradas por padrao.
- [ ] Repetir em build dev Android e, quando possivel, em release.

Cobertura automatizada esperada:

- `localDiagnosticsService` gera resumo com e sem corrida ativa.
- Resumo inclui counts de paths/segments, permissoes, sync, stories/feed, territorio e perfil/ranking/XP.
- Coordenadas sao mascaradas por padrao e `rawPath` completo nao entra no resumo.
- Tokens, emails completos, imagens privadas e payload de terceiros nao entram no export padrao.
- Falha de uma secao nao derruba o resumo/export inteiro.
- Export ZIP contem `localDiagnostics-summary.json` e os arquivos `reports/*`.
- Logger categoriza `SHARE`, `STORY`, `TERRITORY`, `PROFILE`, `RANKING`, `XP` e `UI`.
- Logs de alta frequencia continuam bufferizados/file-system; novo codigo nao deve persistir ponto GPS em AsyncStorage por evento.
- Acoes destrutivas na UI exigem confirmacao.
- Testes nao usam Firebase real, rede real, GPS real nem MapLibre real.

## Observabilidade Sentry e freeze de corrida ativa

Checklist automatizado esperado:

- `sentryService` inicializa uma unica vez e nao chama SDK sem DSN.
- `beforeSend` remove coordenadas cruas, rotas, tokens, auth, email, telefone, NDJSON, ZIP, imagem e payload bruto.
- `captureRunError` envia contexto de corrida sanitizado.
- GPS de alta frequencia vira breadcrumb agregado/throttled, nao evento por ponto.
- Watchdog de performance registra `RUN_UI_POSSIBLE_FREEZE_DETECTED` com contexto de corrida.
- Logger local nao quebra se o SDK Sentry falhar.
- ErrorBoundary registra `REACT_ERROR_BOUNDARY`, aciona checkpoint local e nao limpa corrida ativa.
- Testes nao usam Firestore real, rede real, GPS real nem painel Sentry real.

Comandos focados:

```bash
npm test -- src/services/monitoring/__tests__/sentryMonitoring.test.js --runInBand
npm test -- src/services/diagnostics/__tests__/performanceDiagnosticsService.test.js --runInBand
npm run sentry:check-config
```

Checklist manual dev:

- [ ] Rodar app sem `EXPO_PUBLIC_SENTRY_DSN` e confirmar que nao quebra.
- [ ] Configurar DSN temporario e `EXPO_PUBLIC_SENTRY_ENABLE_DEV=true`.
- [ ] Abrir `Configuracoes > Diagnostico` e enviar evento controlado.
- [ ] Confirmar que Metro/dev nao exige source maps enviados.
- [ ] Confirmar que breadcrumbs automaticos de `console.*` nao poluem o evento.

Checklist manual Android preview/release:

- [ ] Configurar `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` e `SENTRY_AUTH_TOKEN` como secrets no EAS/CI.
- [ ] Gerar build preview/release e verificar no log o upload de source maps.
- [ ] Iniciar corrida, bloquear tela, aguardar, abrir pela notificacao e pelo icone.
- [ ] Pausar, retomar e finalizar a corrida.
- [ ] Enviar evento controlado pelo Diagnostico no mesmo build.
- [ ] Confirmar `release`, `dist`, `environment`, `buildProfile`, `appVariant`, `runId` anonimizado e `userId` anonimizado.
- [ ] Confirmar stack trace com arquivo/linha original.
- [ ] Buscar no payload por `latitude`, `longitude`, coordenada real, `Authorization`, `token`, email e rota completa; nao pode aparecer.
- [ ] Confirmar breadcrumbs de start/countdown, permissao, watcher, background task, notificacao, AppState, restore/reconcile, snapshot canonico e UI/map render.

Cenarios de falha para reproduzir com diagnostico ligado:

- [ ] Negar foreground location.
- [ ] Negar background location.
- [ ] Negar notificacao Android 13+.
- [ ] GPS fraco ou salto de localizacao.
- [ ] Internet desligada.
- [ ] Storage cheio/simulado ou erro de AsyncStorage/FileSystem.
- [ ] Background task falhando.
- [ ] Notificacao nao abrindo a corrida ativa.
- [ ] App voltando de background com corrida ativa.
- [ ] Erro forçado em `MapScreen`.
- [ ] Stall simulado de event loop para validar `RUN_UI_POSSIBLE_FREEZE_DETECTED`.

## Casos ruins que precisam ser testados

- Usuário nega localização.
- GPS fica impreciso.
- Internet cai durante corrida.
- App fecha durante corrida.
- Usuário tenta finalizar corrida sem distância.
- Firestore falha.
- Ranking sem dados.
- Perfil sem foto/nome.

## Validacao Android real - hardening da corrida ativa (2026-07-21)

Pre-condicoes:

- usar aparelho Android 13+ e, se possivel, um Android 14/15 com fabricante que aplique economia agressiva;
- instalar build limpa, conceder localizacao precisa e "o tempo todo" e testar notificacao tanto concedida quanto negada;
- abrir `Configuracoes > Diagnostico`, anotar ambiente/build e limpar apenas logs antigos, nunca corridas;
- repetir a matriz em dev client e APK release/preview. Expo Go nao valida foreground service/task nativa deste projeto.

Roteiro principal:

1. Iniciar corrida livre, caminhar/correr por pelo menos 15 minutos e confirmar notificacao persistente, cronometro e mapa.
2. Alternar 5 vezes entre app ativo, Home, outro app e tela bloqueada, mantendo cada estado por 1-3 minutos.
3. Abrir pelo icone e pela notificacao; confirmar mesmo `runId`, distancia monotona, tempo derivado dos timestamps e nenhum segmento extra sem pausa.
4. Pausar com app e com notificacao, esperar 2 minutos, retomar e confirmar que a pausa nao entra na duracao e cria apenas o segmento esperado.
5. Desligar internet por 5 minutos. Confirmar que GPS, checkpoint, resumo e historico local continuam; religar e observar sync posterior sem duplicata.
6. Entrar em tunel/garagem ou desativar localizacao temporariamente. Confirmar aviso/erro registrado, ausencia de linha falsa e retomada sem perder a sessao.
7. Com a tela bloqueada, matar somente o processo pelo Android Studio/`adb shell am kill com.wayper.app` (nao `force-stop`), aguardar fixes e reabrir. Confirmar recovery com pontos do lote headless ou, no pior caso, ate o ultimo checkpoint de aproximadamente 5 segundos.
8. Repetir com `adb shell am force-stop com.wayper.app`. O Android bloqueia novas entregas ate abertura manual; ao abrir, a corrida deve reaparecer recuperavel ate o ultimo checkpoint e nunca ser substituida por uma nova.
9. No modo zonas, percorrer um loop por pelo menos 10 minutos. Confirmar previa no maximo a cada ~5 segundos, UI responsiva e calculo definitivo/deferido usando a rota completa depois do save local.
10. Finalizar offline e durante GPS fraco. Confirmar ordem `FINISHING` -> snapshot final -> historico local -> limpeza do checkpoint -> tarefas territoriais/XP/sync.
11. Simular falha de storage/save final em build de teste. Confirmar que o resumo nao apaga `wayper:activeRun:v2` e que a proxima abertura oferece finalizar/sincronizar novamente.
12. Fazer corrida longa de 2-4 horas (ou replay controlado de fixes em build de teste), observando memoria, tamanho/count de chunks, latencia de checkpoint, mapa e diagnostico.

Evidencias a coletar sem dados sensiveis:

- sequencia de eventos `RUN_STARTED`, `RUN_POINT_BATCH_SUMMARY`, `RUN_CHECKPOINT_SAVED`, pausa/retomada, background service/task, recovery, `RUN_FINISHING`, `RUN_FINISH_SAVED` e limpeza;
- contagens raw/trusted/segments, distancia e elapsed antes/depois de cada reentrada;
- `adb logcat` filtrado por `Wayper`, `ExpoLocation`, `TaskManager`, `ForegroundServiceStartNotAllowedException`, `SecurityException` e `ActivityManager`;
- captura da notificacao/Task Manager sem expor rota, conta ou coordenadas;
- ZIP/JSON leve de diagnostico com coordenadas mascaradas.

Criterios de aprovacao:

- nenhuma corrida nova e criada sobre snapshot `RUNNING`, `PAUSED`, `FINISHING` ou `FINISHED` ainda nao confirmado no historico;
- foreground/background duplicados resultam em um unico ponto confiavel;
- nenhuma escrita do historico `runs` ocorre por fix GPS;
- perda esperada em kill abrupto fica limitada ao ultimo checkpoint/lote, sem zerar a corrida;
- negar `POST_NOTIFICATIONS` reduz visibilidade e acoes, mas nao derruba o app; negar background exibe limitacao e nao promete rastreamento perfeito;
- falha territorial, de internet, notificacao ou save final aparece no diagnostico e nao apaga a corrida.

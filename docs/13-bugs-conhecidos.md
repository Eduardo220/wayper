# Bugs Conhecidos e Riscos

Use este arquivo para registrar bugs, riscos e limitacoes conhecidas enquanto nao viram issue detalhada. Nao apague bug conhecido sem registrar motivo, evidencia e decisao.

## Convencao de status

- `BLOQUEADO`: depende de credencial, aparelho, ambiente externo ou decisao.
- `EM_VALIDAÇÃO`: correcao ou mitigacao existe, mas ainda precisa validacao.
- `PRECISA_TESTE_REAL`: exige aparelho fisico, build release/dev real, rede real ou cenario de rua.
- `CORRIGIDO`: correcao aplicada e registrada com evidencia.
- `ADIADO`: reconhecido, mas fora da rodada atual.
- `LEGADO`: comportamento antigo conhecido que nao deve ser usado como base nova.

## Modelo para registrar um bug

```md
### BUG-YYYYMMDD-001 - Titulo curto

- ID: BUG-YYYYMMDD-001
- Titulo:
- Status: BLOQUEADO | EM_VALIDAÇÃO | PRECISA_TESTE_REAL | CORRIGIDO | ADIADO | LEGADO
- Severidade: critica | alta | media | baixa
- Area:
- Descricao:
- Como reproduzir:
  1.
  2.
  3.
- Evidencia:
- Causa provavel:
- Arquivos relacionados:
- Correcao aplicada:
- Teste necessario:
- Data: YYYY-MM-DD
- Decisao/observacao:
```

## Bugs ativos

Há bugs funcionais reproduzidos e ainda em validação nesta rodada. Eles
permanecem ativos até que os testes indicados em cada registro sejam concluídos;
nenhum deles foi promovido silenciosamente a corrigido por causa de um reteste
parcial.

## Bugs em investigacao

### BUG-20260621-001 - Congelamento/reentrada instavel durante corrida ativa

- ID: BUG-20260621-001
- Titulo: Congelamento/reentrada instavel durante corrida ativa
- Status: EM_VALIDACAO
- Severidade: critica
- Area: Corrida ativa, background, notificacao, MapScreen, recovery, Sentry
- Descricao: Ao iniciar uma corrida, bloquear a tela, colocar o celular no bolso, reabrir o app pela notificacao permanente/icone, exportar diagnostico pela corrida ativa ou finalizar, a UI pode congelar, ficar sem responder, permanecer em `EXPORTANDO`, perder a corrida ou voltar como se nada estivesse rodando.
- Como reproduzir:
  1. Gerar build dev/preview Android com diagnostico local e Sentry configurado.
  2. Iniciar corrida no `Mapa`.
  3. Bloquear tela e aguardar.
  4. Reabrir pelo corpo da notificacao persistente.
  5. Repetir abrindo pelo icone do app.
  6. Tocar no atalho `Diagnostico` durante corrida ativa.
  7. Durante ou logo apos o export, tocar em `Finalizar`.
  8. Pausar, retomar e finalizar tambem sem export para comparar.
- Evidencia: relato critico do Eduardo em 2026-06-21; auditoria de codigo encontrou o atalho ativo chamando export ZIP completo com NDJSON/bundle/JSZip dentro da `MapScreen` e a finalizacao aguardando captura territorial antes do save local em corrida por zonas. Sem payload Sentry/source map autenticado ainda.
- Causa provavel: concorrencia no caminho critico da corrida ativa. O export emergencial pesado podia disputar storage/event loop com GPS/UI/finalizacao e deixar a tela presa em `EXPORTANDO`; a finalizacao podia aguardar tarefas pesadas antes de liberar resumo/historico. Reentrada/background/notificacao continuam exigindo validacao fisica para confirmar se ha causa adicional.
- Arquivos relacionados: `src/screens/MapScreen.js`, `src/services/diagnostics/diagnosticExportService.js`, `src/services/runTracking/activeRunTrackingService.js`, `src/services/runTracking/activeRunRuntimeService.js`, `src/services/run/runNotificationService.js`, `src/services/run/runAutoSaveService.js`, `src/services/runOfflineStorageService.js`, `src/services/monitoring/sentryService.js`, `src/services/diagnostics/performanceDiagnosticsService.js`.
- Correcao aplicada: instrumentacao Sentry/local adicionada para start/countdown/permissao, watcher, background task, notificacao, AppState, restore/reconcile, snapshot canonico, finish lock, UI heartbeat, event-loop freeze provavel e map render stall, com sanitizacao e GPS throttled. O atalho ativo passou a gerar JSON leve com timeout/cancelamento em vez de ZIP pesado; finalizar cancela/libera export em andamento, salva localmente antes de territorio/XP/sync e defere tarefas pesadas com logs recuperaveis. Em 2026-07-21, a task de GPS foi extraida para bootstrap headless, ingestao/transicoes/escritas passaram a ser serializadas, checkpoint canonico virou lote de ~5 segundos/limite de pontos, `MapScreen` deixou de processar o mesmo fix em paralelo e atualiza mapa em ate ~1 Hz, previa territorial passou a 5 segundos e o checkpoint so e limpo apos confirmacao do mesmo `localRunId` no historico. Em 2026-07-24, freeze, lock idempotente, save mínimo confirmado e limpeza foram extraídos para `runFinalizationService`; a UI passou a ser liberada antes da criação/processamento da fila, e o seed da Expedição permite reconciliação após reinício.
- Teste necessario: repetir em aparelho fisico Android dev e preview/release com `EXPO_PUBLIC_SENTRY_DSN` e `SENTRY_AUTH_TOKEN` configurados; confirmar evento `RUN_UI_POSSIBLE_FREEZE_DETECTED` ou breadcrumbs de reentrada sem coordenadas cruas; executar a matriz `docs/12-guia-de-testes.md` (kill de processo, force-stop, tela bloqueada, offline, GPS perdido, zonas e corrida longa); validar que `RUN_FINISH_LOCAL_MIN_SAVE_COMPLETED` ocorre antes de tarefas deferidas e que finalizar durante export registra `RUN_DIAGNOSTIC_EXPORT_CANCELLED_FOR_FINISH`.
- Evidencia da Fase C em 2026-07-24: 7 suites criticas/87 testes automatizados passaram. Um Android fisico foi inicialmente detectado por ADB como `unauthorized`; naquele momento nenhum teste foi executado no aparelho e o status do bug não mudou.
- Evidencia da Fase D em 2026-07-24: 52 suites/468 testes passaram e o bundle Android com 2.334 módulos foi exportado. O Dev Client também abriu no Samsung SM-A546E com Android 16/API 36 e carregou o bundle atual, mas nenhuma corrida ativa, tela bloqueada, kill ou reentrada foi testada; o smoke básico não altera `EM_VALIDACAO`.
- Evidencia física posterior em 2026-07-24: o mesmo aparelho manteve coleta/foreground service por 12 min 32 s com tela apagada e reabriu pela notificação sem crash/ANR. O gate continuou reprovado por falhas de ação da notificação, storage/finalização e recovery, registradas abaixo. O stall `RUN_UI_POSSIBLE_FREEZE_DETECTED` de 11,87 s deve ser medido novamente após reduzir o I/O.
- Reteste físico parcial em 2026-07-24: uma corrida nova confirmou pausa/retomada
  no app e finalização local sem freeze, erro de bundle ou falsa perda da
  corrida. O bug continua `EM_VALIDACAO` porque notificação, tela bloqueada,
  kill/force-stop, preview/release e economia agressiva não foram repetidos após
  o último hardening.
- Data: 2026-06-21
- Decisao/observacao: Sentry complementa o ZIP/NDJSON local. O bug nao pode ser marcado como corrigido ate haver reproducao/validacao fisica e simbolicacao autenticada no painel.

### BUG-20260724-001 - Pausar/retomar pela notificação perde a identidade

- ID: BUG-20260724-001
- Titulo: Pausar/retomar pela notificação perde a identidade
- Status: EM_VALIDACAO
- Severidade: critica
- Area: Notificação Android, runtime headless, recovery
- Descricao: a ação nativa é recebida, mas a reconciliação pode usar
  `userId: "offline"` e rejeitar a corrida autenticada com `user_mismatch`.
- Evidencia: reprodução no Samsung SM-A546E, Android 16/API 36. Pausa/retomada
  no app funcionou; pela notificação falhou.
- Causa confirmada: o runtime não preservava/resolvia o `userId` do snapshot
  atual antes do fallback offline.
- Correcao aplicada: snapshot/runtime carregam `userId`; a ação consulta o
  snapshot atual; starts concorrentes são coalescidos e o ticker nativo assume
  os segundos para reduzir reinícios do foreground service. A ação agora só
  confirma sucesso quando o mesmo `activeRunId` retorna `PAUSED`/`RUNNING`; caso
  contrário preserva o estado anterior e não grava checkpoint de sucesso.
- Arquivos relacionados: `src/services/run/runNotificationService.js`,
  `src/services/runTracking/activeRunRuntimeService.js`.
- Teste necessario: nova build física; pausar/retomar pela notificação com tela
  bloqueada e confirmar o mesmo `localRunId`, path e segmentos.
- Evidencia automatizada adicional: testes rejeitam retorno `RUNNING` após pausa
  e retorno `PAUSED` após retomada; a suíte completa ficou em 52/487.
- Data: 2026-07-24
- Decisao/observacao: commit `307f1df`; não marcar como corrigido antes do reteste.

### BUG-20260724-002 - Finalização excede o limite do AsyncStorage

- ID: BUG-20260724-002
- Titulo: Finalização excede o limite do AsyncStorage
- Status: EM_VALIDACAO
- Severidade: critica
- Area: Autosave, checkpoint legado, histórico, Android
- Descricao: a finalização única levou aproximadamente 47 segundos, abriu o
  resumo com métricas incoerentes e falhou em salvar o histórico com
  `SQLITE_FULL[13]`, apesar de haver espaço livre no aparelho.
- Evidencia: banco RKStorage próximo do limite padrão e payload da corrida
  serializado repetidamente; eventos de persistência podiam retroalimentar o
  autosave.
- Causa confirmada: redundância de aliases/path no checkpoint/histórico, janela
  legada agressiva e feedback de evento, combinados com o limite padrão do banco.
- Correcao aplicada: checkpoint legado em 15 s e sem eco próprio; envelope final
  compacto; histórico schema v2 compacto com reidratação na leitura; limite
  Android de 32 MB por config plugin; save oficial antes do rascunho fallback.
  O resumo reutiliza o save mínimo oficial com `forceWrite`, mantém retry em
  falha e não aguarda território nem fila derivada.
- Arquivos relacionados: `app.json`,
  `plugins/withAsyncStorageDatabaseSize.cjs`,
  `src/services/run/runAutoSaveService.js`,
  `src/services/runOfflineStorageService.js`, `src/utils/sync.js`,
  `src/services/run/runFinalizationService.js`.
- Teste necessario: executar corrida com rota real e duração representativa,
  medir tempo/volume e confirmar um único item no histórico após reiniciar o
  app. Repetir depois em preview/release.
- Evidencia automatizada adicional: save de detalhes força atualização do
  registro existente e falha preserva o fluxo de retry; export e build Android
  passaram. Naquele momento, a persistência física ainda estava pendente.
- Evidencia física parcial: uma corrida nova gerou `RUN_SAVED_LOCAL`,
  `RUN_FINISH_LOCAL_MIN_SAVE_COMPLETED`, cleanup por ID e confirmação
  `Corrida salva`, sem `SQLITE_FULL`. O teste foi curto e sem rota relevante;
  histórico após reinício e corrida longa ainda precisam ser medidos.
- Data: 2026-07-24
- Decisao/observacao: commit `c3acc03`; SQLite continua opção condicionada a
  medição, não correção automática.

### BUG-20260724-003 - Toque duplicado e recovery corrompem o resultado final

- ID: BUG-20260724-003
- Titulo: Toque duplicado e recovery corrompem o resultado final
- Status: EM_VALIDACAO
- Severidade: critica
- Area: Finalização, lock, recovery, duração, rota
- Descricao: o segundo toque era ignorado, mas seu `finally` liberava o lock da
  primeira finalização. Depois, recovery duplicou a rota/distância ao comparar
  timestamps ISO e numéricos como chaves diferentes; a duração armazenada ainda
  incorporou o tempo pausado.
- Evidencia: reprodução física com corrida recuperada apresentando
  aproximadamente o dobro de pontos/distância e duração incompatível com a
  timeline da pausa.
- Causa confirmada: ownership do lock não era local à chamada, dedupe não
  normalizava timestamp e a duração armazenada tinha precedência excessiva.
- Correcao aplicada: apenas a chamada proprietária libera o lock; dedupe usa
  timestamp normalizado + coordenada; timeline de pausa vence storage; timeouts
  da finalização foram reduzidos. Finalizar em `PAUSED` consolida a pausa aberta,
  retomada acumula imediatamente `now - pausedAt`, merges preservam o total
  pausado monotônico e a limpeza recebe o ID esperado e bloqueia mismatch sem
  remover snapshot, backup ou chunks.
- Arquivos relacionados: `src/screens/MapScreen.js`,
  `src/services/run/runFinalizationService.js`,
  `src/services/runTracking/activeRunState.js`.
- Teste necessario: duplo toque, pausa longa, finalização única e reabertura sem
  duplicar rota/distância.
- Evidencia automatizada adicional: finalização após 60 s de pausa manteve 10 s
  ativos; testes de limpeza por ID preservaram as corridas divergentes; suíte
  focada anterior 6/109 e suíte completa anterior 52/487 aprovadas. A regressão
  específica de retomada foi consolidada no commit `2b9c8ab`; depois do
  hardening final, 4 suítes/89 e a suíte completa 52/493 passaram.
- Evidencia física parcial: corrida nova pausou em `00:21`, permaneceu parada por
  mais de 20 segundos, retomou sem incorporar o intervalo e finalizou em
  `01:07`. O resumo preservou `01:07`. Duplo toque, rota real e reabertura ainda
  não foram repetidos; o status permanece `EM_VALIDACAO`.
- Data: 2026-07-24
- Decisao/observacao: commits `ec8d236`, `58c16d8` e `2b9c8ab`; não marcar como
  corrigido antes de concluir o restante do reteste.

### BUG-20260724-004 - Finalização dependia de carregamento tardio de módulo

- ID: BUG-20260724-004
- Titulo: Finalização dependia de carregamento tardio de módulo
- Status: EM_VALIDACAO
- Severidade: critica
- Area: Finalização, recovery, Metro/bundle, offline
- Descricao: ao finalizar uma corrida pausada no Dev Client, a interface voltou
  ao mapa ocioso e registrou `FINISH_FAILED`, embora o snapshot continuasse
  preservado e recuperável.
- Evidencia: reprodução física com
  `LoadBundleFromServerRequestError: Could not load bundle` durante a resolução
  tardia das dependências de finalização. A reabertura recuperou a corrida
  pausada; portanto o dado não havia sido apagado, mas a UI comunicou estado
  incorreto.
- Causa confirmada: `runFinalizationService` usava `import()` dentro de freeze,
  persistência e fila; `runRecoveryService` também carregava tracking sob
  demanda. O catch aguardava snapshot sem timeout, não consultava o checkpoint
  legado quando a leitura retornava `null` e podia reiniciar tracking enquanto a
  parada de background ainda estava em andamento.
- Correcao aplicada: dependências locais são importadas estaticamente e injetadas
  pela composição; ausência gera `RUN_FINALIZATION_DEPENDENCIES_MISSING`;
  finalização/recovery não contêm `import()`; limpeza exige método canônico e
  confirmação explícita; a falha lê snapshot e recovery com timeout, restaura
  `RUNNING`/`PAUSED` ou apresenta modal; restart espera a parada de background e
  rearma novamente se ela exceder o timeout.
- Arquivos relacionados: `src/screens/MapScreen.js`,
  `src/services/run/runFinalizationService.js`,
  `src/services/run/runRecoveryService.js` e testes correspondentes.
- Teste necessario:
  1. desconectar o Dev Client do Metro e finalizar normalmente, confirmando que
     o save mínimo não tenta buscar outro bundle;
  2. em execução separada e controlada, induzir falha pré-save e confirmar
     restauração/recovery sem lock preso nem estado ocioso falso;
  3. repetir a finalização em APK preview/release offline.
- Evidencia automatizada: 4 suítes/89 testes focados, suíte completa 52/493,
  export Android com 2.334 módulos e build `devDebug` com 631 tarefas aprovadas.
- Evidencia física parcial: a corrida antiga foi recuperada e finalizada depois
  do patch; uma corrida nova finalizou com save mínimo, cleanup, liberação da UI
  e tarefas derivadas em ordem, sem `FINISH_FAILED` ou erro de bundle. A falha
  controlada após o último hardening ainda não foi exercitada.
- Data: 2026-07-24
- Decisao/observacao: commit `9e2dbdf`; manter `EM_VALIDACAO` até separar e
  concluir perda de Metro, falha induzida e offline/preview/release.

## Bugs corrigidos

Nenhum bug corrigido registrado neste arquivo no momento.

## Bugs que exigem teste real

| ID | Titulo | Status | Severidade | Area | Evidencia atual | Teste necessario | Data |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BUG-20260620-001 | Background/tela bloqueada sem validacao fisica completa | PRECISA_TESTE_REAL | alta | Corrida ativa, GPS, Android | Risco conhecido da rodada local-first; emulador nao fecha o cenario real. | Executar `docs/22-teste-real-corrida-background.md` e `docs/wayper/15-checklist-validacao-corrida-ativa.md` em aparelho fisico dev e release. | 2026-06-20 |
| BUG-20260620-002 | Economia agressiva de bateria Android pode matar processo | PRECISA_TESTE_REAL | alta | Android, background, notificacao | Risco conhecido em fabricantes reais mesmo com foreground service. | Testar fabricantes reais com economia de bateria ligada/desligada e registrar resultado. | 2026-06-20 |
| BUG-20260620-003 | Source maps/Sentry sem validacao autenticada final | BLOQUEADO | media | Observabilidade, release | Falta evidencia de upload autenticado e simbolicacao real no painel. | Validar com credenciais reais e registrar evidencia sem expor tokens. | 2026-06-20 |
| BUG-20260620-004 | APK prod assinado com debug em validacao local antiga | BLOQUEADO | alta | Android release | Artefato debug-signed nao e publicavel. | Configurar assinatura release real e validar instalacao/publicabilidade. | 2026-06-20 |

## Riscos atuais da rodada local-first

| Risco | Status | Impacto | Proximo passo |
| --- | --- | --- | --- |
| Feed/Friends/Groups Firestore-first | BLOQUEADO | Social/grupos podem falhar offline enquanto Home principal ja e local-first. | Criar repositories/fallbacks incrementais antes de novas features sociais, com aprovacao de escopo. |
| Stories sem upload remoto | ADIADO | Story local permanece `PENDING_SYNC`. | Definir contrato remoto e fila de upload antes de implementar sync. |
| XP/conquistas sem sync remoto | ADIADO | Progresso e local por enquanto. | Definir contrato remoto idempotente. |
| Sync territorial remoto incompleto | ADIADO | Territorio local nao vira social/remoto completo. | Definir fila/contrato separados do sync de runs. |
| AsyncStorage com rotas/historicos longos | EM_VALIDAÇÃO | O limite padrão foi atingido em teste físico; schema compacto v2 e limite Android de 32 MB ainda precisam reteste. | Medir nova build antes de decidir SQLite. |
| Janela de checkpoint canonico de ate ~5 segundos | PRECISA_TESTE_REAL | Kill abrupto pode perder os fixes ainda apenas em memoria; lote background concluido faz flush imediato. | Medir em aparelho real e ajustar limites somente com evidencia de I/O/bateria. |
| Servicos legados presentes | LEGADO | Reativacao acidental pode duplicar arquitetura. | Manter docs/IA e testes bloqueando uso como fonte nova. |
| `console.*` legado fora de fluxos criticos | ADIADO | Pode poluir logs ou Sentry se reconfigurado. | Migrar gradualmente para `logger.js`. |

## Como registrar um bug

1. Use ID previsivel `BUG-YYYYMMDD-001`, incrementando o sufixo no mesmo dia.
2. Descreva o comportamento observado, nao uma hipotese solta.
3. Inclua evidencia: tela, log, export de diagnostico, comando, commit, arquivo ou relato de teste.
4. Separe causa provavel de causa confirmada.
5. Informe arquivos relacionados quando souber, mas nao invente arquivo.
6. Se corrigiu, registre a correcao aplicada e mova/atualize para `CORRIGIDO`.
7. Se ainda exige aparelho fisico, rede real, credencial ou build release, mantenha `PRECISA_TESTE_REAL` ou `BLOQUEADO`.
8. Nao apague bug antigo: registre decisao, data e motivo.

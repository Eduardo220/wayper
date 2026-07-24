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

Nenhum bug funcional especifico registrado nesta rodada. Os riscos abaixo permanecem ativos e devem virar bugs formais quando houver reproducao, evidencia ou impacto direto em usuario.

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
- Correcao aplicada: instrumentacao Sentry/local adicionada para start/countdown/permissao, watcher, background task, notificacao, AppState, restore/reconcile, snapshot canonico, finish lock, UI heartbeat, event-loop freeze provavel e map render stall, com sanitizacao e GPS throttled. O atalho ativo passou a gerar JSON leve com timeout/cancelamento em vez de ZIP pesado; finalizar cancela/libera export em andamento, salva localmente antes de territorio/XP/sync e defere tarefas pesadas com logs recuperaveis. Em 2026-07-21, a task de GPS foi extraida para bootstrap headless, ingestao/transicoes/escritas passaram a ser serializadas, checkpoint canonico virou lote de ~5 segundos/limite de pontos, `MapScreen` deixou de processar o mesmo fix em paralelo e atualiza mapa em ate ~1 Hz, previa territorial passou a 5 segundos e o checkpoint so e limpo apos confirmacao do mesmo `localRunId` no historico.
- Teste necessario: repetir em aparelho fisico Android dev e preview/release com `EXPO_PUBLIC_SENTRY_DSN` e `SENTRY_AUTH_TOKEN` configurados; confirmar evento `RUN_UI_POSSIBLE_FREEZE_DETECTED` ou breadcrumbs de reentrada sem coordenadas cruas; executar a matriz `docs/12-guia-de-testes.md` (kill de processo, force-stop, tela bloqueada, offline, GPS perdido, zonas e corrida longa); validar que `RUN_FINISH_LOCAL_MIN_SAVE_COMPLETED` ocorre antes de tarefas deferidas e que finalizar durante export registra `RUN_DIAGNOSTIC_EXPORT_CANCELLED_FOR_FINISH`.
- Evidencia da Fase C em 2026-07-24: 7 suites criticas/87 testes automatizados passaram. Um Android fisico `RQCW306MRLM` foi detectado por ADB, mas permaneceu `unauthorized`; nenhum teste foi executado no aparelho e o status do bug nao muda.
- Data: 2026-06-21
- Decisao/observacao: Sentry complementa o ZIP/NDJSON local. O bug nao pode ser marcado como corrigido ate haver reproducao/validacao fisica e simbolicacao autenticada no painel.

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
| AsyncStorage com rotas/historicos longos | EM_VALIDAÇÃO | Parse/carregamento pode pesar. | Medir volume real antes de decidir SQLite. |
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

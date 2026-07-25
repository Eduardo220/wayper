# Fase D — finalização mínima e pipeline da Expedição

**Data:** 2026-07-24

**Branch:** `develop`

**Base:** `3d86370`

**Escopo executado:** extração da finalização, contrato mínimo e evolução da fila

**Status:** implementado; registro original reprovado, com reteste curto
posterior parcialmente aprovado e gate físico global aberto

## Diagnóstico

A `MapScreen` concentrava freeze, checkpoint, snapshot, rascunho, confirmação do
histórico, limpeza de recovery e criação da fila. A fila já era persistente e
idempotente por tarefa, mas seus resultados ficavam somente em metadata e não
havia projeção modular reabrível nem reconciliação de uma corrida salva antes do
enqueue.

A implementação consolidou os mecanismos existentes. Não alterou o pipeline de
GPS, não criou fila paralela, não tornou Firestore obrigatório e não aguardou
território, XP, ranking, social ou sync para liberar a interface.

## Arquivos analisados

- `src/screens/MapScreen.js`;
- `src/services/runTracking/activeRunTrackingService.js`;
- `src/services/run/runAutoSaveService.js`;
- `src/services/run/runRecoveryService.js`;
- `src/services/run/runDeferredTaskQueueService.js`;
- `src/repositories/runDeferredTaskQueueRepository.js`;
- `src/utils/sync.js`;
- testes de corrida, diagnostics, fila, recovery e sync;
- documentação de produto, arquitetura, dados, fluxos, ADRs, testes e bugs.

## Arquivos alterados

### Produção

- `src/services/run/runFinalizationService.js`;
- `src/services/run/runDeferredTaskQueueService.js`;
- `src/repositories/runDeferredTaskQueueRepository.js`;
- `src/screens/MapScreen.js`.

### Testes

- `src/services/run/__tests__/runFinalizationService.test.js`;
- `src/services/run/__tests__/runDeferredTaskQueueService.test.js`;
- `src/services/diagnostics/__tests__/diagnostics.test.js`;
- `src/services/runTracking/__tests__/activeRunState.test.js`.

### Documentação

- roadmap, backlog, arquitetura, modelo de dados, fluxos, guia de testes, bugs,
  diagnóstico, changelog, revisão, ADRs e Relatório da Expedição;
- este relatório.

## Justificativas

- o lock crítico precisa sobreviver à remontagem da tela e pertencer ao domínio;
- a sessão ativa só pode ser limpa após confirmação do mesmo ID no histórico;
- o seed versionado fecha a janela entre UI liberada e criação da fila;
- `result` explícito torna cada módulo consultável sem interpretar logs;
- reconciliação no startup recupera trabalho ausente com as mesmas chaves
  idempotentes;
- preservar a chave/storage e o repository existentes reduz risco e facilita
  rollback.

## Testes executados

Conjunto focado final:

```bash
npm test -- --runInBand \
  src/services/diagnostics/__tests__/diagnostics.test.js \
  src/services/runTracking/__tests__/activeRunState.test.js \
  src/services/run/__tests__/runFinalizationService.test.js \
  src/services/run/__tests__/runDeferredTaskQueueService.test.js
```

Resultado: 4 suites e 50 testes aprovados.

Suíte completa final:

```bash
npm test -- --runInBand
```

Resultado: 52 suites e 468 testes aprovados, 0 snapshots.

Bundle Android:

```bash
node scripts/with-env.cjs .env.development -- \
  npx expo export --platform android \
  --output-dir /tmp/wayper-phase-d-final-v2-export-20260724
```

Resultado: export concluído, 2.334 módulos empacotados.

Build e smoke Android:

```bash
npm run android:build:dev
adb install -r android/app/build/outputs/apk/dev/debug/app-dev-debug.apk
adb reverse tcp:8081 tcp:8081
npm run dev:server
adb shell am start -W -a android.intent.action.VIEW \
  -d 'wayper-dev://expo-development-client/?url=http%3A%2F%2F127.0.0.1%3A8081' \
  com.wayper.app.dev
```

Resultado:

- build `devDebug` concluído;
- APK reinstalado preservando dados;
- Samsung SM-A546E, Android 16/API 36;
- activity aberta em estado `WARM`, 388 ms informados pelo Android;
- bundle dev atual carregado via Metro, 2.440 módulos;
- processo permaneceu ativo;
- logs confirmaram registro da task de background e início do autosave, sem
  sessão ativa.

O `logcat` mostrou uma `ReactNoCrashSoftException` de foco antes do contexto ficar
pronto durante o bootstrap do Dev Client, além de mensagens do fabricante. Não
houve queda observada, mas o evento fica registrado como risco de ambiente; não
foi tratado como validação de corrida.

Durante o desenvolvimento, a primeira suíte completa encontrou duas asserções
estruturais que ainda exigiam a lógica dentro da `MapScreen`; os testes foram
corrigidos para validar o serviço extraído e a execução final passou integralmente.

## Resultados

- save mínimo formal e idempotente;
- cleanup somente depois da confirmação local;
- falha de save mantém recovery;
- criação da fila depois de `RUN_FINISH_UI_RELEASED`;
- estados/resultados persistentes para métricas, território, progressão, ranking,
  social e sync;
- desafios/recompensas explicitamente `not_applicable`;
- reconciliação automática de seeds pendentes.

### Validação física posterior

Uma corrida real no Samsung SM-A546E, Android 16/API 36, confirmou coleta com
tela apagada e reentrada, mas revelou `user_mismatch` nas ações da notificação,
pressão de storage até `SQLITE_FULL`, liberação indevida do lock por toque
duplicado, rota duplicada no recovery e duração com pausa incorreta. A
finalização única abriu o resumo depois de aproximadamente 47 segundos, porém o
save local falhou. Naquela execução, o gate da Fase D ficou reprovado.

Uma build posterior aprovou pausa/retomada e finalização no app em corrida curta,
com save mínimo e cleanup confirmados. Essa evidência não abrange notificação,
rota real, offline, falha induzida ou preview/release.

Registro sanitizado:
`docs/audits/2026-07-24-fase-cd-validacao-fisica-remediacao.md`.

## Riscos restantes

- a corrida física original revelou falhas críticas; a nova build validou apenas
  o subfluxo curto de pausa/retomada e finalização no app;
- lock em memória evita concorrência no processo atual; após crash, a proteção é
  a confirmação idempotente no histórico;
- o relatório visual ainda não consome o contrato modular;
- AsyncStorage e tempo real de processamento precisam medição em corridas longas;
- Firestore, ranking e social mantêm suas limitações remotas já registradas.

## Validações físicas pendentes

- finalizar com tela bloqueada e após reentrada por ícone/notificação;
- matar o processo antes e depois do save mínimo;
- matar o processo depois da UI e antes do enqueue, então validar reconciliação;
- finalizar offline e religar rede sem duplicar corrida, XP ou território;
- repetir em corrida livre e por zonas, dev client e preview/release;
- validar economia agressiva de bateria.

O aparelho foi autorizado durante a Fase D. As execuções físicas posteriores
estão registradas no relatório de remediação. Apenas o subfluxo curto de
pausa/retomada e finalização no app foi aprovado; os demais cenários críticos
continuam pendentes.

## Próximos passos

1. concluir o reteste físico restante de notificação, recovery, offline,
   falha induzida e preview/release;
2. medir duração do freeze/save mínimo e crescimento do storage;
3. adaptar `RunSummaryModal` e `RunDetailScreen` ao estado modular na Fase 3;
4. manter integrações comerciais fora do fluxo.

## Rollback

O rollback é o revert deste commit. A chave da fila foi preservada e o leitor do
schema 2 aceita `metadata.lastResult` legado; nenhuma migração destrutiva ou
remoção de storage foi executada.

## Commit sugerido

`feat(run): extrair finalizacao e pipeline da expedicao`

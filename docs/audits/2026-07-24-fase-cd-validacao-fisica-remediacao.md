# Fases C/D — validação física e remediação

**Data:** 2026-07-24  
**Branch:** `develop`  
**Aparelho:** Samsung SM-A546E, Android 16/API 36  
**Perfil:** Dev Client (`com.wayper.app.dev`)  
**Status:** gate físico reprovado; correções automatizadas aprovadas; nova build
instalada; reteste físico pendente

Este registro não contém coordenadas, rota, identificador da corrida ou
identificador pessoal. Os logs brutos usados no diagnóstico permanecem somente
em `/tmp` e não devem ser versionados.

## Diagnóstico

O teste físico comprovou que a coleta headless e o foreground service
permaneceram ativos por 12 min 32 s com tela apagada e aparelho em `Dozing`. A
reentrada pela notificação restaurou a corrida e os controles no app continuaram
funcionando. Não houve crash ou ANR observado.

O gate não foi aprovado porque três grupos de falha afetaram o fluxo:

1. pausar/retomar pela notificação foi recebido pelo Android, mas o runtime usou
   `userId: "offline"` e o recovery rejeitou a corrida autenticada por
   `user_mismatch`;
2. checkpoints legados redundantes e um eco de persistência do autosave
   regravaram payloads grandes até o AsyncStorage responder
   `SQLITE_FULL[13]`, embora o aparelho tivesse espaço livre;
3. um segundo toque em finalizar liberou o lock da primeira chamada; no recovery,
   timestamps numéricos e ISO não foram reconhecidos como o mesmo ponto,
   duplicando rota/distância. O tempo pausado também foi incorporado pela
   precedência indevida da duração armazenada.

A finalização única posterior removeu a notificação e abriu o resumo, mas levou
aproximadamente 47 segundos, exibiu métricas incoerentes e registrou
`RUN_SAVE_FAILED`. Portanto, não existe evidência de persistência válida daquela
corrida no histórico.

Também foi observado `RUN_UI_POSSIBLE_FREEZE_DETECTED` com 11,87 s. O evento
permanece como risco a medir depois da redução de I/O; ele não foi classificado
isoladamente como crash.

## Arquivos analisados

- `src/screens/MapScreen.js`;
- `src/services/run/runFinalizationService.js`;
- `src/services/run/runNotificationService.js`;
- `src/services/run/runAutoSaveService.js`;
- `src/services/runOfflineStorageService.js`;
- `src/services/runTracking/activeRunRuntimeService.js`;
- `src/services/runTracking/activeRunState.js`;
- `src/utils/sync.js`;
- módulo Android da notificação e configuração do AsyncStorage;
- testes de tracking, recovery, finalização, notificação, autosave e sync;
- logs sanitizados de ADB/Metro e estado do serviço durante a execução.

## Arquivos alterados

### Notificação

- `src/services/run/runNotificationService.js`;
- `src/services/runTracking/activeRunRuntimeService.js`;
- testes correspondentes.

### Persistência

- `app.json`;
- `plugins/withAsyncStorageDatabaseSize.cjs`;
- `src/services/run/runAutoSaveService.js`;
- `src/services/runOfflineStorageService.js`;
- `src/utils/sync.js`;
- testes correspondentes.

### Finalização e recovery

- `src/screens/MapScreen.js`;
- `src/services/run/runFinalizationService.js`;
- `src/services/runTracking/activeRunState.js`;
- testes correspondentes.

### Documentação

- relatórios das fases C/D;
- arquitetura, regras de corrida, roadmap, backlog, testes, bugs, changelog e
  revisão de implementação.

## Justificativas

- A ação da notificação deve usar o usuário do snapshot canônico atual e nunca
  inventar identidade `offline` quando já existe corrida autenticada.
- O ticker nativo atualiza os segundos; reiniciar o foreground service a cada
  segundo não adiciona precisão e aumenta contenção.
- O checkpoint legado é compatibilidade, não um espelho por evento do snapshot
  canônico; seus próprios eventos de persistência não podem formar feedback.
- O histórico continua na chave `runs`, mas a representação persistida passa a
  ser compacta e sem aliases repetidos; a leitura reidrata o contrato público.
- O limite Android do banco do AsyncStorage passa a 32 MB por config plugin
  versionado. Isso é margem operacional, não substituto para compactação nem
  autorização para writes por ponto.
- Um toque duplicado não pode liberar o lock adquirido por outra chamada.
- Dedupe precisa normalizar timestamp ISO/numérico antes de comparar pontos de
  recovery.
- Quando existe timeline de pausa, a duração derivada dessa timeline vence um
  valor armazenado que incluiu o intervalo pausado.
- A finalização tenta primeiro o histórico oficial compacto; o rascunho legado é
  fallback. Timeouts curtos impedem que tarefas auxiliares prendam a interface.

## Testes executados

### Remediação da notificação

```bash
npm test -- --runInBand \
  src/services/run/__tests__/runNotificationService.test.js \
  src/services/runTracking/__tests__/activeRunTrackingService.test.js
```

Resultado: 2 suites e 49 testes aprovados.

### Remediação da persistência

```bash
npm test -- --runInBand \
  src/services/run/__tests__/runAutoSaveService.test.js \
  src/services/__tests__/runOfflineStorageService.test.js \
  src/utils/__tests__/syncRunHistory.test.js
```

Resultado: 3 suites e 29 testes aprovados.

```bash
npm test -- --runInBand \
  src/services/run/__tests__/activeRunLocalFirst.integration.test.js \
  src/services/run/__tests__/runRecoveryService.test.js
```

Resultado: 2 suites e 22 testes aprovados.

`npx expo config --type prebuild` também foi executado com sucesso depois de
ajustar o plugin para CommonJS (`.cjs`).

### Remediação da finalização/recovery

```bash
npm test -- --runInBand \
  src/services/diagnostics/__tests__/diagnostics.test.js \
  src/services/runTracking/__tests__/activeRunState.test.js \
  src/services/run/__tests__/runFinalizationService.test.js
```

Resultado: 3 suites e 44 testes aprovados.

```bash
npm test -- --runInBand \
  src/services/runTracking/__tests__/activeRunTrackingService.test.js \
  src/services/run/__tests__/activeRunLocalFirst.integration.test.js \
  src/services/run/__tests__/runRecoveryService.test.js \
  src/services/run/__tests__/runFinalizationService.test.js \
  src/services/run/__tests__/runNotificationService.test.js \
  src/services/run/__tests__/runAutoSaveService.test.js \
  src/services/diagnostics/__tests__/diagnostics.test.js
```

Resultado: 7 suites e 104 testes aprovados.

`node --check src/screens/MapScreen.js` não é uma validação aplicável porque o
Node não interpreta JSX diretamente; o arquivo foi processado pelos testes via
Babel/Jest.

### Suíte completa

```bash
npm test -- --runInBand
```

Resultado: 52 suites e 476 testes aprovados, 0 snapshots, em 17,506 s
informados pelo Jest.

### Build preparada para o reteste

```bash
npm run android:build:dev
```

Resultado:

- `assembleDevDebug` concluído em 1 min 53 s;
- 631 tarefas, 74 executadas e 557 atualizadas;
- APK Dev Client gerado com aproximadamente 320 MB;
- `BuildConfig.AsyncStorage_db_size = 32L` confirmado no código nativo gerado;
- primeira tentativa no sandbox falhou apenas porque `~/.gradle` era somente
  leitura; a repetição autorizada fora do sandbox concluiu;
- Gradle reportou depreciações para compatibilidade futura com Gradle 9, sem
  falha da build.

Preparação física:

- `adb install -r`: `Success`, preservando dados;
- Dev Client aberto via deep link em estado `WARM`, 402 ms informados;
- processo e activity ficaram visíveis/resumidos;
- nenhum warning/erro apareceu no recorte recente dos tags
  `AndroidRuntime`, `ReactNative`, `ReactNativeJS` e `Expo`.

Essa evidência valida build, configuração nativa, instalação e bootstrap. Não
valida as correções funcionais da corrida.

## Resultado físico

| Cenário | Resultado |
| --- | --- |
| Tela apagada por mais de 10 minutos | Aprovado no Dev Client |
| Foreground service durante `Dozing` | Aprovado no Dev Client |
| Checkpoints com app em background | Aprovado, com excesso de I/O detectado |
| Reentrada pelo corpo da notificação | Aprovado no Dev Client |
| Pausa/retomada no app | Controles responderam; duração final ficou incorreta |
| Pausa/retomada pela notificação | Reprovado por `user_mismatch` |
| Duplo toque em finalizar | Segundo toque foi ignorado, mas liberou lock indevidamente |
| Recovery da mesma rota | Reprovado por duplicação de pontos/distância |
| Finalização única | Resumo abriu; save local reprovado por `SQLITE_FULL` |
| Remoção da notificação após finalizar | Aprovado |

## Riscos restantes

- As correções ainda não foram exercitadas em uma nova corrida física.
- A base antiga do Dev Client pode conter artefato incompleto; não deve servir
  como evidência do novo build.
- O limite de 32 MB reduz risco imediato, mas SQLite deve ser reavaliado se
  medições mostrarem parse ou volume incompatíveis com corridas longas.
- Preview/release, economia agressiva, kill/force-stop, zonas, offline com
  reconexão, replay e compartilhamento continuam sem validação desta rodada.
- O stall de UI precisa ser medido novamente após a compactação.

## Validações físicas pendentes

1. iniciar uma corrida nova, sem reutilizar o artefato final corrompido;
2. repetir tela apagada, reentrada e pausar/retomar pela notificação;
3. pausar no app, aguardar e confirmar que a pausa não entra na duração;
4. tocar duas vezes em finalizar e confirmar uma única transação;
5. confirmar resumo em poucos segundos, histórico local e notificação removida;
6. reabrir o app e confirmar que rota/distância não duplicaram;
7. depois repetir os cenários críticos em preview/release e economia agressiva.

## Próximos passos

- executar o reteste curto de regressão;
- somente então decidir se o gate físico C/D pode ser aprovado;
- manter a Fase 3 visual bloqueada até a persistência básica ficar comprovada.

## Commits

- `307f1df fix(run): corrigir acoes da notificacao ativa`;
- `c3acc03 perf(run): compactar checkpoints e historico local`;
- `ec8d236 fix(run): tornar finalizacao e recovery idempotentes`.

Commit sugerido para este registro:

- consolidação: `docs(test): registrar gate fisico e remediacoes`;
- evidência da build: `docs(test): registrar build do reteste fisico`.

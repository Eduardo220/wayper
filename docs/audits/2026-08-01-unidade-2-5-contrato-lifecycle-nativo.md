# Unidade 2.5 — contrato e isolamento do lifecycle nativo

> **Status:** implementada no nível automatizado; validação Android física aberta
> **Tipo:** auditoria de implementação e contrato técnico
> **Escopo:** lifecycle process-local do tracking nativo
> **Data:** 2026-08-01
> **Branch:** `develop`
> **HEAD inicial:** `2c01e43`
> **Fontes principais:** `AGENTS.md`, `docs/00-fontes-do-projeto.md`,
> `docs/product/direcao-estrategica-completa.md`, `docs/04-arquitetura.md` e
> `docs/08-decisoes-tecnicas.md`

## Objetivo e fronteira

Esta unidade fecha a base de liveness, identidade e isolamento necessária para
a serialização completa da Unidade 3. Ela não implementa recovery completo,
finalização, notificação, focus mode, sync ou alterações visuais.

O snapshot local continua sendo a fonte canônica da corrida. O estado descrito
neste documento pertence somente ao controlador process-local da task nativa e
não cria uma segunda corrida ou um segundo serviço de tracking.

Arquivos da unidade:

- `src/services/runTracking/activeRunTrackingService.js`;
- `src/services/runTracking/__tests__/activeRunLifecycleContract.test.js`;
- `src/services/runTracking/__tests__/activeRunTrackingService.test.js`;
- `src/services/run/__tests__/activeRunLocalFirst.integration.test.js`, com
  claim explícito depois de processo recriado;
- este relatório.

## Diagnóstico anterior

O lifecycle pendente possuía quatro falhas estruturais relacionadas:

1. `backgroundLifecycleQueue` mantinha como tail a Promise nativa real;
2. o timeout encerrava somente a espera do caller, sem invalidar a operação nem
   liberar a fila;
3. o catch do start aguardava a fila de ingestão, enquanto pausa e finalização
   ocupavam a ingestão e aguardavam o lifecycle;
4. task ativa com owner desconhecido era atribuída à corrida corrente apenas
   porque o probe nativo retornava `true`.

O ciclo concreto era:

```text
lifecycle/start-failure
    -> aguarda handler na ingestão
    -> pause ocupa a ingestão
    -> pause aguarda lifecycle/stop
    -> lifecycle continua ocupado pelo start
```

A geração também era reutilizada para intents iguais. Start e stop escreviam
`backgroundStarted` e owner antes da verificação final, e o callback headless
não carregava cerca de geração.

## Mapa resultante

```text
solicitação UI/runtime
    -> activeRunTrackingService
    -> fila lógica com deadline
    -> probe/start/stop nativo
    -> cerca de operationId + generation + owner
    -> confirmação ou FAILED_RECOVERABLE
    -> atualização autorizada do runtime/snapshot

callback headless
    -> captura owner + nativeGeneration antes do primeiro await
    -> fila de ingestão independente
    -> revalidação antes de cada ponto e checkpoint
```

O grafo de espera passa a ser:

```text
transição/ingestão -> lifecycle -> operação nativa
callback GPS       -> ingestão
lifecycle          -- sinal assíncrono, sem await --> ingestão
```

Não existe mais a aresta síncrona `lifecycle -> ingestão` capaz de fechar o
ciclo.

## Contrato resultante

### Estado

O controlador usa os estados process-locais:

- `IDLE`;
- `STARTING`;
- `ACTIVE`;
- `STOPPING`;
- `FAILED_RECOVERABLE`.

`FAILED_RECOVERABLE` não autoriza nova chamada nativa concorrente. Ele exige
probe/reconciliação posterior e preserva o snapshot da corrida.

### Fila e liveness

Cada solicitação recebe `operationId` único. Quando começa a executar, recebe
uma `generation` estritamente crescente. A tail da fila aponta para o término
lógico limitado por deadline, e não para a duração ilimitada da Promise nativa.

Assim:

- rejeição não envenena a fila;
- timeout invalida o token autoritativo;
- o item lógico é liberado em todos os resultados;
- uma solicitação posterior entra na fila normalmente;
- se ainda existir uma Promise nativa incerta, a solicitação posterior termina
  como `reconciliation_required`, sem disparar outro start/stop perigoso;
- existe no máximo uma referência para operação nativa não resolvida, sem mapa
  ou fila auxiliar ilimitada;
- o probe público de status também é `single-flight`: chamadas concorrentes
  compartilham a mesma Promise e um timeout não cria novos probes nativos
  enquanto o anterior continuar pendente;
- probe iniciado antes ou durante uma transição é somente observacional: seu
  resultado não pode rebaixar nem restaurar estado depois que o lifecycle
  avançar, mesmo quando a generation numérica ainda for a mesma.

### Timeout e cancelamento lógico

O timeout significa apenas que o resultado deixou de ser autoritativo. Ele não
afirma que Android/Expo cancelou a operação.

No deadline:

1. o caller recebe `false`;
2. o token da operação recebe `authoritative = false`;
3. a fila lógica é liberada;
4. o estado vira `FAILED_RECOVERABLE`;
5. `reconciliationRequired` fica explícito;
6. a Promise original permanece somente com observador tardio;
7. sua resolução ou rejeição posterior deixa de ser autoritativa e gera
   `RUN_BACKGROUND_LIFECYCLE_LATE_RESULT_DISCARDED`;
8. se um start nativo terminar tarde e ainda for a única operação incerta na
   fronteira nativa, o serviço tenta um stop compensatório cercado; ele não
   atribui owner nem ativa a geração antiga;
9. falha no cleanup deixa `reconciliationRequired` explícito, sem liberar uma
   nova chamada nativa perigosa.

Quando um stop pendente termina depois do timeout, ele só pode liberar o owner
antigo se ainda for a única operação incerta na fronteira nativa e a identidade
esperada continuar igual. Essa liberação não adota o target novo e não limpa o
estado de reconciliação; uma operação posterior confirmada é quem converge o
lifecycle.

### Owner, aliases e handoff

O owner primário é o `activeRunId` canônico. A comparação considera os aliases
existentes `activeRunId`, `localRunId`, `runId`, `id` e `legacyId`.

- owner igual é idempotente;
- owner conhecido divergente resulta em `owner_mismatch`;
- start e stop de outro owner não alcançam a task atual;
- task ativa com owner process-local desconhecido resulta em
  `owner_unknown` e exige reconciliação;
- probe de task ativa valida os aliases do owner contra o target canônico
  atual; owner A com snapshot B nunca é reportado como estado consistente;
- handoff direto entre dois owners ativos é proibido;
- um novo owner somente pode ser estabelecido depois de stop confirmado;
- se o target mudar durante probe, force restart ou stop, somente a confirmação
  física de que a task de A parou pode liberar A; B nunca é adotado por esse
  resultado antigo;
- após recriação de processo, o claim de uma task já ativa exige chamada
  explícita com `ownerClaim.mode = "process_recovery"`, motivo registrado e
  snapshot canônico RUNNING da mesma identidade.

O claim explícito é contrato para o reconciliador futuro. Nenhum fluxo de
recovery de produção foi ampliado nesta unidade.

### Generation e callbacks

Há duas medidas relacionadas e monotônicas:

- `generation`: epoch de toda operação lógica executada;
- `nativeGeneration`: epoch da task nativa confirmada ou explicitamente
  reclamada.

Elas são process-locais e não alteram o schema persistido. Reset/cold start
invalida tokens do processo anterior; a reconciliação persistente pertence à
Unidade 4.

O callback captura owner e `nativeGeneration` antes do primeiro `await`.
Ingestão e checkpoint revalidam essa cerca. Payloads com generation antiga são
descartados, e pontos em tempo real anteriores à ativação da nova task também
são rejeitados. Callback sem owner nativo confirmado também é descartado; após
cold start ele só volta a ser autorizado quando o reconciliador fizer o claim
explícito da mesma corrida.

O Expo Location não fornece provenance de generation no payload Android. Por
isso a garantia automatizada usa envelope explícito, cerca capturada no
processo e corte temporal. A confirmação contra buffers reais de fabricantes
continua no gate físico; este relatório não afirma validação Android.

### Observabilidade

`getTrackingRuntimeStatus()` expõe somente o resumo estrutural do lifecycle:

- estado;
- generation e nativeGeneration;
- owner e aliases;
- operação ativa;
- operação nativa incerta;
- probe de status e operação de lifecycle capturada por ele;
- último outcome;
- último resultado tardio descartado;
- reconciliação necessária;
- liberação da fila.

Os eventos novos não incluem coordenadas, rota ou snapshots completos.

## Testes contratuais

O arquivo focado contém 43 testes: os 28 cenários exigidos e 15 regressões
adicionais para interleavings descobertas na revisão. A cobertura inclui:

- start normal, rejeitado, pendurado e com timeout;
- liveness depois de erro e timeout;
- owner igual, divergente, aliases e handoff;
- monotonicidade de generation;
- callbacks, start e stop tardios;
- start/start, stop/stop, start/stop e stop/start;
- múltiplas intents concorrentes;
- falha seguida de sucesso;
- ausência do ciclo com ingestão e pausa;
- GPS durante transição;
- ingestão de geração antiga;
- stop confirmado após troca de alvo, liberando o owner anterior;
- rejeição de stop após troca de alvo sem emitir erro para a corrida nova;
- probe público de status pendurado sem crescimento do número de Promises
  nativas;
- timeout de probe antigo sem rebaixar lifecycle novo;
- probe iniciado durante stop sem restaurar status nativo antigo;
- erro de callback antigo sem alterar runtime, notificação ou listener atual;
- task ativa sem owner process-local exige reconciliação explícita;
- task parada com owner retido preserva a identidade e exige reconciliação;
- task ativa com owner confirmado preserva o estado consistente;
- task parada sem owner preserva o estado consistente;
- probe ativo detecta owner A divergente do target B;
- mudança A→B durante probe permite liberar A explicitamente antes de iniciar
  B;
- probe A que confirma a task parada libera A antes do probe/start de B;
- force restart libera A depois do stop confirmado, ainda que o target mude;
- falha de force restart depois da troca para B preserva A, marca reconciliação
  e não emite erro para listeners de B;
- stop confirmado depois do timeout libera somente A e mantém reconciliação
  até B ser confirmado.

Os testes legados passavam antes da correção e, isoladamente, aceitavam o
contrato inseguro. O gate final abaixo foi executado sobre uma cópia exata do
índice, materializada fora do working tree; portanto não depende dos hunks
preservados de recovery, finalização, notificação, focus mode, sync ou UI.

| Comando | Resultado |
| --- | --- |
| `node --check src/services/runTracking/activeRunTrackingService.js` na cópia exata do índice | passou sem saída |
| `npm test -- src/services/runTracking/__tests__/activeRunLifecycleContract.test.js --runInBand --detectOpenHandles` na cópia exata do índice | 1 suíte e 43 testes passaram; nenhum handle aberto detectado; warning experimental do Node |
| `npm test -- src/services/runTracking/__tests__/activeRunLifecycleContract.test.js src/services/runTracking/__tests__/activeRunTrackingService.test.js src/services/run/__tests__/activeRunLocalFirst.integration.test.js --runInBand` na cópia exata do índice | 3 suítes e 96 testes passaram; 0 snapshots; warning experimental do Node |
| `npm test -- --runInBand` na cópia exata do índice | 56 suítes e 605 testes passaram; 0 snapshots; warning experimental do Node e warning esperado do teste de feed offline |
| `git diff --cached --check` | passou sem saída |

## Riscos e limites

Permanecem fora desta unidade:

- serialização completa de intents de start, stop, pausa e retomada;
- política de recovery/cold start que decide quando emitir o claim explícito;
- nenhum call site de recovery de produção emite esse claim ainda; até a
  Unidade 4 reconciliar a identidade, callbacks headless após recriação são
  descartados de forma conservadora e a task não é adotada silenciosamente;
- revalidação de notificação;
- finalização resiliente e save mínimo;
- focus mode;
- segurança do sync;
- comportamento do Expo/Android quando uma Promise nativa nunca assenta mesmo
  após processo recriado;
- callback que o SDK só entrega depois de uma nova geração, sem provenance no
  payload, depende também do corte temporal; buffers reais de fabricante
  continuam sendo risco do gate físico;
- validação em Android físico.

## Rollback

O rollback é a reversão isolada do commit da Unidade 2.5. Ele remove o
controlador limitado por deadline, as cercas e os testes sem alterar schema de
storage, dependência, configuração nativa ou API remota. O rollback reintroduz
os riscos de deadlock, adoção silenciosa de owner e resultado tardio descritos
neste relatório.

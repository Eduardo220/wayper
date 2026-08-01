# Unidade 3 — serialização do lifecycle nativo

> **Status:** concluída no nível automatizado; validação Android física aberta
> **Tipo:** auditoria de implementação e contrato técnico
> **Escopo:** `start`, `stop`, `pause` e `resume`
> **Data:** 2026-08-01
> **Branch:** `develop`
> **HEAD inicial:** `bf7858b`

## Objetivo e fronteira

Esta unidade reutiliza a fila, os deadlines, `operationId`, `generation`,
`nativeGeneration` e owner introduzidos pela Unidade 2.5. Não cria serviço,
fila, store ou estado canônico paralelo.

Ficaram fora do escopo recovery de cold start/processo morto, finalização,
focus mode, sync, território, XP, ranking, bateria e refatoração da
`MapScreen`.

## Fontes consultadas

- `AGENTS.md`;
- `docs/00-fontes-do-projeto.md`;
- `docs/product/direcao-estrategica-completa.md`;
- `README.md`;
- auditoria da Unidade 2.5;
- fontes de arquitetura, regras de corrida, background, diagnóstico e testes
  indicadas pela matriz do domínio;
- serviços, consumidores e testes diretamente relacionados ao lifecycle.

## Diagnóstico

O contrato process-local da Unidade 2.5 já impedia envenenamento da fila e
fornecia cercas de identidade, mas os fluxos canônicos ainda não aguardavam o
resultado nativo de modo uniforme:

1. `startActiveRun` publicava `RUNNING` e a UI anunciava início antes da
   confirmação do start nativo;
2. a `MapScreen` disparava um segundo start background depois do start
   canônico;
3. `pauseActiveRun` podia devolver `PAUSED` mesmo sem stop confirmado, e o
   consumidor aceitava apenas o status;
4. a `MapScreen` disparava outro stop depois da pausa canônica;
5. `resumeActiveRun` reabria o segmento antes da confirmação do start nativo e
   a UI aceitava apenas o status;
6. a `MapScreen` disparava outro start depois do resume canônico;
7. chamadas por notificação não cercavam a identidade da corrida e podiam
   anunciar sucesso por status sem confirmação da transição;
8. resultados detalhados do lifecycle não chegavam aos consumidores
   canônicos, que não distinguiam confirmação, falha e incerteza.

Esses caminhos permitiam estado visual falso, task duplicada, efeito fora de
ordem e operação antiga atuando sobre owner ou generation posterior.

## Mapa do fluxo e chamadas

| Operação | Solicitantes autoritativos | Confirmação | Efeito nativo |
| --- | --- | --- | --- |
| start | `MapScreen` e retry canônico do serviço | resultado explícito do start | fila existente da Unidade 2.5 |
| stop | pause e API de tracking cercada | resultado explícito do stop | mesma fila |
| pause | `MapScreen` e ação da notificação | stop confirmado para owner/generation | `pauseActiveRun` |
| resume | `MapScreen` e ação da notificação | start confirmado para owner/generation | `resumeActiveRun` |

Watcher foreground continua controlado pela tela, mas não é fonte canônica do
lifecycle nativo. Task background, owner, generation e callback headless
continuam pertencendo ao serviço. O lifecycle não aguarda a fila de ingestão;
falhas somente sinalizam checkpoint de forma assíncrona.

## Contrato implementado

### Resultado explícito

As operações internas produzem um resultado transitório com operação,
`operationId`, generation esperada e observada, owner esperado e observado,
outcome, confirmação, autoridade, timeout, necessidade de reconciliação e
estado nativo. `transitionConfirmed` é anexado somente ao valor retornado ao
caller e não cria novo estado persistido.

As APIs públicas de baixo nível mantêm o retorno booleano por compatibilidade;
callers canônicos solicitam o resultado detalhado.

### Start

O snapshot novo é persistido como `STARTING`. O mesmo owner converge para a
operação existente ou para a task já confirmada, sem reinicializar sessão nem
criar segunda task. Owner divergente não é adotado. `RUNNING`, evento de
sucesso, UI e watcher foreground somente avançam depois da confirmação nativa
autoritativa. Falha ou timeout mantém estado explícito recuperável e não
publica sucesso.

### Stop e pause

Stop captura owner e native generation esperados, revalida-os imediatamente
antes do efeito e antes da publicação do resultado. Stop antigo não alcança
generation posterior nem remove seu owner/task. Stop repetido já confirmado é
idempotente.

Pause preserva primeiro o estado canônico `PAUSED`, solicita exatamente um
stop pela fila existente e só devolve `transitionConfirmed: true` após a
confirmação segura. Falha ou incerteza registra recovery pendente e não emite
sucesso. Não existe espera circular com ingestão ou checkpoint.

### Resume

Resume mantém o snapshot `PAUSED` enquanto usa o mesmo contrato de start.
Somente owner e generation ainda válidos podem reabrir o segmento e publicar
`RUNNING`. Chamadas duplicadas convergem; callback ou resultado antigo é
descartado.

### Timeout e resultado tardio

Timeout libera a fila lógica, marca reconciliação necessária e invalida a
autoridade do token. Uma Promise nativa tardia é observada, mas não pode mudar
a sessão atual. Falha ou timeout anterior não envenena operações futuras.

## Classificação dos hunks pendentes

- **Unidade 3:** resultado explícito, serialização canônica de
  start/stop/pause/resume, cercas de owner/generation, consumidores mínimos e
  testes contratuais;
- **Unidade 4 — recovery:** hidratação/reclaim após processo, task headless sem
  corrida, limpeza órfã, cancelamento de recovery e serviço de runtime;
- **Unidade 5 — finalização:** freezing, finish/cancel e stop da finalização;
- **Unidade 6 — focus mode:** estado visual, mapa ocultável, layout e controles;
- **outro:** capacidade/permissões, diagnóstico, sync e documentação de outras
  frentes;
- **inválido ou redundante:** retries nativos paralelos na pausa e chamadas
  diretas de start/stop da `MapScreen`; foram substituídos pelo único caminho
  autoritativo.

Os hunks das Unidades 4, 5 e 6 e os de sync permaneceram fora do índice e não
foram alterados por esta entrega.

## Validação automatizada do índice exato

| Comando | Suítes | Testes | Resultado |
| --- | ---: | ---: | --- |
| lifecycle, tracking e notificação com `--detectOpenHandles` | 3 | 128 | passou |
| active state, tracking incremental, checkpoint e local-first | 4 | 54 | passou |
| suíte completa `npm test -- --runInBand` | 56 | 623 | passou |

O arquivo `activeRunRuntimeService.test.js` presente no working tree é novo e
pertence ao recovery da Unidade 4; por isso não integra a árvore exata desta
unidade. A validação Android física não foi executada.

## Riscos, rollback e próximo passo

Resta validar em Android físico start/stop do foreground service, bloqueio de
tela, ação de notificação e comportamento de callbacks tardios de diferentes
fabricantes. O rollback é o revert integral do commit da Unidade 3; não há
migração de schema nem dado remoto.

Somente após essa entrega, a Unidade 4 pode consumir o contrato explícito para
recovery, sem reabrir a serialização implementada aqui.

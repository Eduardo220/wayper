# Auditoria da direção oficial de produto

**Data:** 2026-07-24  
**Branch auditada:** `develop`  
**Commit auditado:** `ac802b3`  
**Referência estável consultada:** `main` em `551a692`  
**Escopo:** Fase A — diagnóstico, sem mudança de código de produção

## 1. Resumo executivo

A base de `develop` já implementa parte importante da fundação técnica exigida pela
nova direção:

- tracking canônico local, inclusive em tarefa headless;
- checkpoints persistidos e recuperação de corrida;
- salvamento local antes de sincronização;
- finalização que libera a interface antes dos trabalhos derivados;
- fila persistente e reprocessável para efeitos pós-corrida;
- territórios, XP, ranking, replay, compartilhamento e diagnósticos já existentes
  em graus diferentes de maturidade.

O produto, porém, ainda comunica e organiza a experiência como “corrida com mapa e
captura de zonas”. O maior desvio não é a falta de mecânicas; é onde e como elas
aparecem:

- o mapa e a captura territorial continuam centrais durante a atividade;
- `MapScreen` ainda orquestra tracking, finalização, território e interface em um
  componente com mais de sete mil linhas;
- o pós-corrida está fragmentado entre `RunSummaryModal`, `RunDetailScreen`,
  replay, compartilhamento e cartões territoriais;
- não existe contrato persistente de “Expedição” que permita resultados parciais,
  atualização incremental e reabertura consistente;
- documentação, README e instruções para agentes mantêm a visão anterior;
- planos, entitlements, anúncios, parceiros, pagamentos e feature flags ainda não
  têm implementação — o que é adequado nesta etapa, mas precisa estar explicitado
  como direção, não como funcionalidade entregue.

Portanto, a recomendação é consolidar primeiro o contexto permanente e os
contratos. Alterações de produção devem começar somente depois, pela segurança da
corrida e pela extração da finalização para fora da tela.

## 2. Evidência de repositório

### 2.1 Estado encontrado

- branch ativa: `develop`;
- `HEAD`: `ac802b3` (`feat(run): harden active run reliability`);
- único item fora do controle de versão no início da auditoria:
  `docs/product/direcao-estrategica-completa.md`;
- nenhum arquivo rastreado estava modificado;
- `main` foi usada apenas como referência;
- `main` e `develop` estão divergentes; `main` não é ancestral direto de
  `develop`;
- `develop` contém uma fundação local-first mais recente do que `main`;
- `AGENTS.md` e `CLAUDE.md` existem na referência `main`, mas não existem em
  `develop`.

O arquivo não rastreado foi tratado como material do usuário: não foi alterado,
movido nem incluído implicitamente nesta fase.

### 2.2 Ordem de fontes aplicada

1. código atual de `develop`;
2. código de `main`;
3. `README.md`;
4. documentação em `docs/`;
5. ADRs;
6. issues e pull requests, quando disponíveis;
7. planos locais;
8. anotações externas.

Há uma divergência documental: `docs/wayper/00-index.md` e o antigo `AGENTS.md` de
`main` declaram `docs/wayper/` como fonte canônica antes do código. A ordem acima,
determinada para esta revisão, deve substituir essa orientação na Fase B.

## 3. Inventário da implementação

| Domínio | Implementação principal | Estado observado | Aderência à nova direção | Recomendação |
|---|---|---|---|---|
| Bootstrap | `App.js`, `src/navigation/MainNavigator.js` | Tarefas headless registradas antes da UI; fila e sync inicializados na navegação | Parcial | Manter bootstrap headless; retirar da navegação qualquer dependência crítica futura |
| Tracking canônico | `src/services/runTracking/activeRunTrackingService.js` | Estado local canônico, lotes, checkpoints e snapshot final | Forte | Tratar como núcleo reutilizável e evitar segunda implementação |
| Runtime de corrida | `src/services/runTracking/activeRunRuntimeService.js` | Reconciliação entre serviço, notificação e UI | Forte | Preservar contrato independente da tela |
| Tarefa headless | `src/tasks/activeRunLocationTask.js` | Coleta em background sem componente montado | Forte | Manter caminho crítico pequeno e observável |
| GPS e filtros | `src/services/runTracking/pointFilters.js`, `gpsQuality.js`, `trackSmoothing.js` | Validação, qualidade e suavização separadas | Forte | Não adicionar território, anúncios ou rede nesse caminho |
| Notificação persistente | `src/services/run/runNotificationService.js`, `runNotificationActionTask.js` | Estado e ações básicas da corrida | Forte, com validação física pendente | Validar bloqueio de tela, retomada e restrições de bateria |
| Checkpoints e recuperação | `src/services/checkpoints/checkpointService.js`, `runRecoveryService.js`, `runAutoSaveService.js` | Persistência e recuperação local | Forte | Consolidar sem criar novo store paralelo |
| Salvamento local | `src/utils/sync.js`, `src/repositories/runRepository.js` | Corrida salva localmente com status de sincronização | Forte | Definir formalmente o “mínimo seguro salvo” |
| Fila de sync | `src/services/run/runSyncQueueService.js`, `runSyncQueueRepository.js` | Sincronização remota posterior e reprocessável | Forte | Continuar sem bloquear a atividade |
| Fila pós-corrida | `src/services/run/runDeferredTaskQueueService.js`, `runDeferredTaskQueueRepository.js` | Fila persistente com tentativas, prioridades e estados | Parcial, mas é a base correta | Evoluir esta fila para o pipeline da Expedição; não criar uma fila concorrente |
| Finalização | `stopRun` em `src/screens/MapScreen.js` | Salva local, limpa sessão e abre a UI antes dos derivados | Forte no ordenamento; fraca no acoplamento | Extrair orquestrador idempotente para serviço de domínio |
| Tela ativa | `src/screens/MapScreen.js` | Mapa sempre visível, preview territorial e painel “Capturando Zonas” | Divergente | Introduzir modo foco; mapa deve ser opcional e sem promoção |
| Métricas ativas | painel de corrida em `MapScreen.js` | Tempo e distância; qualidade crítica de GPS e controles | Parcial | Acrescentar pace essencial sem poluir a interface |
| Território | `src/services/territory/*`, `src/repositories/territoryRepository.js` | Captura, células, líderes, privacidade, eventos e antifraude | Parcial | Tornar processamento silencioso e resultado primariamente pós-corrida |
| XP e progressão | `src/repositories/progressionRepository.js`, `src/services/xp/*` | XP local e cálculo territorial; código legado ainda referenciado | Parcial | Definir fórmula oficial e remover cálculo duplicado após migração segura |
| Ranking | `src/services/ranking/*`, `src/repositories/rankingRepository.js`, `RankingScreen.js` | Rankings locais/remotos; tarefa pós-corrida apenas consulta dados | Parcial | Definir resultado derivado e estado próprio no relatório |
| Resumo imediato | `src/components/Runs/RunSummaryModal.js` | Dados básicos, captura/XP estimado, esforço, tags, notas e foto | Divergente/fragmentado | Substituir gradualmente por relatório modular com estados parciais |
| Detalhe da atividade | `src/screens/Runs/RunDetailScreen.js` | Métricas, rota, splits, replay, edição e share | Parcial | Tornar uma porta de reabertura do Relatório da Expedição |
| Replay | `src/utils/runReplay.js`, `RunDetailScreen.js`, `MapScreen.js` | Replay existente para atividades próprias | Parcial | Conectar como módulo secundário do pós-corrida |
| Compartilhamento | `src/components/Runs/RunShareModal.js`, `src/utils/share/*` | Exportação e compartilhamento local-first | Forte como derivado | Nunca bloquear finalização; mostrar somente quando o resultado estiver disponível |
| Feed/social | `src/services/feed/*`, `src/repositories/socialHomeRepository.js` | Feed e relações sociais; há acessos diretos ao Firestore em telas/hooks | Parcial | Migrar gradualmente para providers/repositories, sem bloquear corrida |
| Diagnóstico/Sentry | `src/services/diagnostics/*`, `src/services/monitoring/*` | Diagnóstico local, sanitização e ponte opcional para Sentry | Forte | Preservar opt-in, sanitização e ausência de dados sensíveis |
| Offline legado | `src/services/runService.js`, `src/services/location/locationService.js`, `src/storage/zonesStorage.js` | Caminhos antigos ainda presentes | Risco de duplicação | Inventariar usos antes de desativar; não reativar por conveniência |
| Planos/entitlements | nenhuma implementação encontrada | Ausente | Planejado | Definir contrato antes de UI ou cobrança |
| Anúncios | nenhum SDK/serviço de anúncios encontrado | Ausente | Correto para a etapa | Só integrar após política, consentimento, flags e locais permitidos |
| Parceiros/patrocínios | nenhuma implementação encontrada | Ausente | Planejado | Separar oferta, elegibilidade e apresentação do núcleo da corrida |
| Pagamentos | nenhuma implementação encontrada | Ausente | Planejado | Criar abstração de provedor somente quando houver decisão operacional |
| Feature flags | não há serviço geral | Ausente | Lacuna arquitetural futura | Criar contrato local-first antes de experimentos comerciais |

## 4. Matriz de aderência

Legenda:

- **implementado:** o comportamento existe no código atual;
- **parcial:** existe uma base, mas faltam contrato, cobertura, desacoplamento ou
  validação;
- **ausente:** não foi encontrada implementação;
- **divergente:** o comportamento atual conflita com a direção oficial;
- **legado:** implementação antiga coexistindo com o caminho atual.

| Capacidade | Estado | Evidência e observação |
|---|---|---|
| Corrida silenciosa | Parcial | O serviço trabalha sem interação, mas a tela ativa promove mapa e captura |
| Tracking confiável | Parcial | Arquitetura implementada e testes automatizados existentes; validação Android física continua pendente |
| Tela apagada | Parcial | Background/notificação/checkpoints suportam o caso; matriz física não concluída |
| Background | Parcial | Tarefa headless existe; restrições reais de fabricante/bateria ainda são risco |
| Offline | Implementado | Início, tracking, salvamento e recuperação usam estado local; sync é posterior |
| Finalização resiliente | Parcial avançado | Ordem local-first está correta; orquestração ainda mora em `MapScreen` |
| Salvamento mínimo | Implementado | Rascunho final é persistido e confirmado antes da limpeza da sessão |
| Processamento derivado | Parcial | Fila persistente existe; ranking/feed são tarefas incompletas e falta contrato de resultado |
| Relatório da Expedição | Ausente | Há resumo, detalhe, replay e share separados, sem modelo unificado |
| Territórios | Parcial e divergente | Mecânica existe, mas é exibida durante a corrida e as regras documentais divergem |
| Progressão | Parcial | XP existe; fórmula e apresentação oficial ainda não estão consolidadas |
| Ranking | Parcial | Consultas e telas existem; atualização pós-corrida não produz resultado persistido |
| Entitlements | Ausente | Nenhum resolvedor ou modelo encontrado |
| Anúncios | Ausente | Nenhum SDK encontrado; não há infração em corrida ativa |
| Parceiros | Ausente | Não há domínio ou provider |
| Pagamentos | Ausente | Não há provider ou ledger |
| Feature flags | Ausente | Apenas flags pontuais de diagnóstico/configuração |
| Privacidade | Parcial | Sanitização de diagnóstico e território existe; exposição social da rota exige política única |
| Antifraude | Parcial | Serviço territorial existe; política transversal de recompensas não está definida |
| Reuso e portabilidade | Parcial | Repositories e serviços ajudam; UI monolítica e Firebase direto limitam extração |

## 5. Fluxo real da corrida

### 5.1 Início e acompanhamento

1. `MapScreen` solicita permissões e inicia o tracking canônico.
2. `activeRunTrackingService` persiste o estado ativo.
3. `activeRunLocationTask` pode continuar a coleta fora do ciclo de vida da UI.
4. pontos passam por filtros e são gravados em lotes/checkpoints;
5. runtime e notificação refletem o estado para a interface;
6. o usuário pode pausar, retomar e reabrir a atividade.

O caminho crítico não depende do Firestore e não executa a captura territorial
definitiva a cada ponto. Há preview territorial periódico na tela; ele deve sair
do modo foco, mas não equivale ao processamento definitivo.

### 5.2 Finalização atual

Em `stopRun`, de forma resumida:

1. trava reentrada e muda a interface para finalização;
2. interrompe watchers/timers da UI;
3. força checkpoint e obtém snapshot final canônico;
4. monta o registro mínimo;
5. marca território como pendente quando aplicável;
6. persiste rascunho e corrida local;
7. confirma o identificador salvo;
8. somente então limpa a sessão ativa;
9. enfileira trabalhos pós-corrida;
10. libera a interface e processa derivados em segundo plano.

Isso está alinhado ao princípio de não segurar a finalização por território, XP,
ranking, feed, replay, exportação, compartilhamento ou sync. O risco é a função
continuar dentro de um componente montado e misturar transições visuais com
orquestração de domínio.

### 5.3 Trabalhos derivados atuais

A fila persistente contém:

- salvamento completo;
- sincronização remota;
- captura territorial;
- atualização de XP;
- atualização de ranking;
- atualização de feed;
- diagnóstico pronto;
- limpeza temporária;
- nova tentativa de falhas.

Território e XP têm salvaguardas de idempotência. Já as tarefas de ranking e feed
atualmente carregam dados, mas não materializam um resultado específico da
expedição. Não devem ser consideradas “concluídas” no sentido de produto.

## 6. Divergências entre fontes

| Tema | Fonte/documentação | Código real | Decisão necessária |
|---|---|---|---|
| Fonte canônica | `docs/wayper/00-index.md` prioriza documentação | `develop` contém mudanças posteriores à documentação | Adotar a ordem oficial desta auditoria e atualizar os índices |
| Posicionamento | README e visão descrevem “app de corrida gamificado” | Produto já contém social, ranking, território, replay e progressão | Reposicionar como plataforma de exercício gamificada |
| Momento principal | Documentos destacam mapa e zonas durante a corrida | UI ativa mostra “Capturando Zonas” | Declarar pós-corrida como experiência principal e criar modo foco |
| Território competitivo | Documentos antigos dizem que a ocupação é individual | Serviço atual calcula conquista, defesa, roubo e líderes | Manter comportamento como “implementado sob revisão”; formalizar regra antes de expandir |
| Fila persistente | `docs/16-ideias-de-melhoria.md` ainda trata a fila como ideia | `runDeferredTaskQueueService` já está implementado | Marcar ideia como implementada e documentar lacunas |
| Monetização | Roadmap diz estar fora de escopo | Nova direção aprova conceitualmente assinatura e ecossistema | Mover para fases futuras, sem alegar implementação |
| Instruções de IA | `docs/14-instrucoes-para-ia.md` usa a visão anterior | Não há `AGENTS.md` em `develop` | Criar contexto permanente e atualizar instruções |
| XP no resumo | Documentação promove progressão; modal calcula estimativa com utilitário legado | XP definitivo é trabalho derivado idempotente | Exibir estado pendente/confirmado a partir do pipeline, não recalcular na UI |
| Ranking/feed na fila | Nome da tarefa sugere atualização | Implementação apenas consulta dados | Corrigir semântica ou implementar resultado materializado em fase posterior |
| Firestore | Arquitetura pede repositories/providers | Algumas telas e hooks sociais importam Firestore diretamente | Migrar por domínio; não tocar no caminho crítico da corrida |
| Histórico estável | `main` contém `AGENTS.md` e visão documental antiga | `develop` removeu esses arquivos e avançou a arquitetura | Não restaurar literalmente; recriar regras coerentes com a nova direção |

## 7. Riscos priorizados

### Críticos

1. **Reentrada/congelamento na finalização em Android real.** O bug
   `BUG-20260621-001` permanece dependente de validação física, apesar do
   endurecimento recente.
2. **Perda de confiança por atividade não recuperável.** Qualquer refatoração da
   UI não pode alterar o estado canônico, checkpoints ou a ordem do salvamento.

### Altos

1. **Orquestração dentro de `MapScreen`.** Uma recriação da tela no momento errado
   aumenta complexidade e risco, mesmo com serviços locais robustos.
2. **Dois caminhos históricos de tracking/salvamento.** Serviços legados ainda
   existem e podem ser reutilizados acidentalmente.
3. **Sem contrato de relatório parcial.** Falhas derivadas não têm representação
   única para UI, reabertura e suporte.
4. **Regras territoriais contraditórias.** Evoluir competição sem decisão formal
   pode consolidar comportamento indesejado.
5. **Validação de background incompleta.** Fabricantes e políticas de bateria
   continuam sendo uma variável de produção.

### Médios

1. XP estimado no modal pode divergir do resultado persistido.
2. Ranking/feed possuem tarefas com semântica maior do que o efeito real.
3. Firebase direto em domínios sociais reduz portabilidade e testabilidade.
4. Ausência de flags impede rollout seguro de mudanças visuais e comerciais.
5. Replay, share e detalhe duplicam decisões de apresentação do pós-corrida.

### Baixos nesta etapa

1. Ads, pagamentos e parceiros ainda não existem; o risco atual é implementar
   cedo ou sem limites, não regressão de código.
2. Planos pagos ainda não afetam a corrida; o risco é documentação ambígua criar
   autorização implícita.

## 8. Plano faseado e reversível

### Fase B — contexto permanente

- criar `AGENTS.md`;
- publicar visão, princípios, negócio, planos, parcerias, anúncios, eventos,
  relatório, economia, decisões, hipóteses e critérios em `docs/product/`;
- registrar ADRs;
- reconciliar README, roadmap, backlog e fontes conflitantes;
- separar claramente “implementado”, “aprovado conceitualmente”, “hipótese” e
  “fora de escopo”.

**Rollback:** somente documentação; reverter o commit da fase.

### Fase C — segurança da atividade

- executar a matriz automatizada disponível;
- realizar Android físico para tela bloqueada, background, processo recriado,
  notificação, pausa/retomada, GPS oscilante e offline;
- corrigir apenas falhas comprovadas;
- não alterar gamificação nesta fase.

**Rollback:** commits pequenos por falha corrigida; preservar esquema de checkpoint.

### Fase D — finalização mínima e pipeline

- extrair orquestrador idempotente de `MapScreen`;
- formalizar `minimumSavedRun`;
- evoluir a fila existente, sem criar serviço paralelo;
- persistir estados e resultados parciais;
- garantir retomada após reinício.

**Rollback:** flag local e compatibilidade com os registros/fila atuais.

### Fase E — UI ativa mínima

- modo foco por padrão;
- tempo, distância, pace, estado, GPS crítico e controles;
- mapa opcional;
- nenhum elemento promocional.

**Rollback:** flag de experiência; manter tela atual temporariamente como variante.

### Fase F — Relatório da Expedição

- contrato modular e reabrível;
- métricas, rota, territórios, progressão, ranking, desafios, recompensas,
  parceiros, replay e share com estados independentes;
- atualização incremental sem bloquear a tela.

**Rollback:** adaptar `RunSummaryModal`/`RunDetailScreen` ao contrato antes de
remover qualquer superfície.

### Fase G — planos e entitlements

- resolvedor testável e cache local;
- matriz Free/Plus;
- Pro continua hipótese até validação;
- corrida segura nunca depende de entitlement remoto.

**Rollback:** default conservador e leitura local do último estado conhecido.

### Fase H — monetização e ecossistema

- feature flags, consentimento e métricas;
- anúncios somente em locais permitidos e nunca na corrida;
- parceiros, eventos, criadores e pagamentos por providers desacoplados;
- nenhum provedor deve entrar no núcleo de tracking/finalização.

**Rollback:** kill switch por capacidade e fallback neutro.

## 9. Critérios de aceite da auditoria

- [x] branch ativa e estado do Git confirmados;
- [x] `develop` inspecionada antes de `main`;
- [x] README e instruções históricas para agentes consultados;
- [x] documentação de produto, arquitetura, dados, fluxos, código, deploy, testes,
      bugs, background, offline, diagnóstico, Sentry, zonas, ranking, replay,
      compartilhamento e finalização revisada;
- [x] caminhos atuais e legados identificados;
- [x] matriz de aderência registrada;
- [x] divergências registradas sem suposição silenciosa;
- [x] riscos e plano de rollback registrados;
- [x] nenhuma mudança de produção feita na Fase A.

## 10. Arquivos analisados

### Raiz e configuração

- `README.md`;
- `package.json`;
- `App.js`;
- `AGENTS.md` e `CLAUDE.md` da referência `main`;
- histórico e diferenças entre `main` e `develop`.

### Documentação

- `docs/00-fontes-do-projeto.md` a `docs/24-resumo-rodada-local-first.md`;
- `docs/diagnostics.md`;
- `docs/share-debug.md`;
- todos os documentos em `docs/wayper/`;
- templates de decisão, ideia, proposta, revisão e changelog;
- `docs/product/direcao-estrategica-completa.md`, somente leitura.

### Código representativo

- `src/screens/MapScreen.js`;
- `src/screens/Runs/RunDetailScreen.js`;
- `src/screens/Runs/CorridasScreen.js`;
- `src/components/Runs/RunSummaryModal.js`;
- `src/components/Runs/RunRecoveryModal.js`;
- `src/components/Runs/RunShareModal.js`;
- `src/navigation/MainNavigator.js`;
- `src/services/runTracking/*`;
- `src/tasks/activeRunLocationTask.js`;
- `src/services/run/*`;
- `src/repositories/runRepository.js`;
- `src/repositories/runSyncQueueRepository.js`;
- `src/repositories/runDeferredTaskQueueRepository.js`;
- `src/services/territory/*`;
- `src/repositories/territoryRepository.js`;
- `src/services/xp/*`;
- `src/repositories/progressionRepository.js`;
- `src/services/ranking/*`;
- `src/repositories/rankingRepository.js`;
- `src/services/diagnostics/*`;
- `src/services/monitoring/*`;
- `src/utils/sync.js`;
- `src/utils/runReplay.js`;
- `src/utils/share/*`;
- serviços legados de corrida, localização, zonas e XP.

## 11. Resultado da Fase A

**Arquivos alterados:** somente este relatório.  
**Código de produção alterado:** nenhum.  
**Testes de aplicação necessários nesta fase:** nenhum, pois não houve mudança de
comportamento.  
**Validação física pendente:** toda a matriz descrita em
`docs/22-teste-real-corrida-background.md`, com prioridade para finalização,
background, bloqueio de tela e reabertura por notificação/ícone.  
**Próximo passo:** Fase B — tornar a direção uma regra permanente, reconciliar as
fontes e registrar as decisões.  
**Commit sugerido:** `docs(product): auditar aderência à nova direção oficial`.

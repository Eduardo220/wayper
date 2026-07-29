# Revisões de Implementação

Este arquivo registra revisões feitas após mudanças no código ou na documentação operacional.

## Classificações possíveis

- Alinhado
- Parcialmente alinhado
- Desalinhado

## Formato obrigatório

```md
## YYYY-MM-DD - Revisão da implementação

### Documentos consultados

### Arquivos analisados

### Resultado

Classificação: Alinhado | Parcialmente alinhado | Desalinhado

### Problemas encontrados

### Riscos

### Melhorias sugeridas

### Documentação atualizada

### Ações recomendadas
```

## 2026-07-29 - Revisão da Fase 1A de tracking incremental

### Documentos consultados

`AGENTS.md`, direção estratégica completa, regras da corrida, arquitetura de
tracking, auditoria do lote e testes do domínio.

### Arquivos analisados

Filtros GPS, sessão e paths canônicos, smoothing/render, cache visual,
checkpoint ativo e suítes de tracking/runTracking.

### Resultado

Classificação: Alinhado no escopo da Fase 1A

A ingestão não reconstrói nem simplifica a rota no callback GPS; renderização
completa ocorre em fronteiras explícitas. Distância e métricas permanecem
coerentes em segmentos, recovery e `replace_previous`.

### Problemas encontrados

- render incremental vazava para o payload final;
- velocidade/aceleração podiam permanecer ligadas à aresta removida;
- anti-zigzag atravessava a fronteira entre segmentos;
- accuracy ausente era contabilizada como zero;
- cache podia colidir, ser contaminado e exceder `maxPoints`;
- snapshot ativo bloqueava correção legítima de distância.

### Riscos

- arrays hot são visões efêmeras pertencentes à sessão;
- cache faz assinatura O(n) somente fora do callback crítico;
- validação Android física segue pendente.

### Melhorias sugeridas

Manter o consumo hot serializado e avançar para duração canônica sem misturar
lifecycle ou modo foco.

### Documentação atualizada

- `docs/audits/2026-07-29-fase-1a-tracking-incremental.md`;
- `docs/12-guia-de-testes.md`;
- `docs/18-changelog-produto.md`.

### Ações recomendadas

1. fechar o gate final e o commit seletivo da 1A;
2. corrigir snapshots v2 contaminados antes de fechar a 1B;
3. executar a matriz física depois das unidades da fundação.

## 2026-07-24 - Revisão de pausa e finalização sem lazy load

### Documentos consultados

Arquitetura, fluxos, regras de corrida, ADR-026/028/030, guia/checklist Android,
bugs e auditoria física C/D.

### Arquivos analisados

`MapScreen`, estado/tracking canônico, autosave, finalização, recovery, storage
legado, sync, fila derivada e testes correspondentes.

### Resultado

Classificação: Parcialmente alinhado

O caminho feliz está alinhado: pausa monotônica, save local confirmado, cleanup
por identidade, liberação da UI antes da fila e nenhuma dependência remota ou
carregamento tardio na transação crítica. O subfluxo foi aprovado em corrida
física limpa. A
classificação global permanece parcial porque os cenários de notificação,
falha induzida, rota real, offline e release continuam pendentes.

### Problemas encontrados

Merge podia apagar a pausa acumulada na retomada; `import()` tardio podia abortar
a finalização; fallback não consultava legado após snapshot nulo; leituras de
falha não tinham timeout; cleanup aceitava dependência canônica incompleta; e o
restart podia disputar com a parada do background.

### Riscos

Notificação, force-stop, preview/release, bateria agressiva, zona, sync após
offline e rota longa ainda não têm evidência depois do último patch.

### Melhorias sugeridas

Adicionar teste de integração controlado para falha pré-save/timeout e executar o
restante da matriz física antes de alterar a experiência principal da corrida.

### Documentação atualizada

Arquitetura, fluxos, ADRs, testes, bugs, changelog, checklist, roteiro de
background, resumo local-first e auditoria C/D.

### Ações recomendadas

Preservar a proibição de lazy load no caminho crítico, retestar notificação e
reentrada e depois validar uma corrida real com deslocamento/histórico.

## 2026-07-24 - Revisão das remediações do gate físico C/D

### Documentos consultados

Arquitetura, regras da corrida, guia de testes, roteiro Android real, bugs,
roadmap, backlog e auditorias C/D.

### Arquivos analisados

Notificação/runtime, autosave/storage, histórico/sync, finalização,
`activeRunState`, `MapScreen`, testes e configuração Expo/Android.

### Resultado

Classificação: Parcialmente alinhado

As correções respeitam local-first, não adicionam processamento no GPS, não
duplicam serviços e mantêm tarefas derivadas fora da finalização. Naquele
momento, a classificação continuava parcial porque a nova build ainda não havia
sido retestada fisicamente. O reteste posterior aprovou pausa/retomada e
finalização no app em um ciclo curto, sem fechar o gate global.

### Problemas encontrados

Identidade offline indevida na ação nativa, churn/feedback do checkpoint,
histórico redundante, limite do AsyncStorage, ownership incorreto do lock, dedupe
incompatível com timestamps mistos e precedência incorreta da duração armazenada.

### Riscos

Persistência antiga incompleta no aparelho, stall de UI, preview/release,
economia agressiva, kill/force-stop, zonas e reconexão ainda sem comprovação.

### Melhorias sugeridas

Medir tempo da finalização, crescimento do banco e stalls na nova build; considerar
SQLite apenas com evidência de volume/parse após a compactação.

### Documentação atualizada

Auditorias C/D, arquitetura, regras, testes, bugs, roadmap, backlog, decisões,
changelog e resumo local-first.

### Ações recomendadas

A ação recomendada naquele momento era instalar a nova build, usar corrida nova
e executar o roteiro curto. Essa ação foi concluída parcialmente; notificação,
falha induzida, rota real, offline, preview/release e demais cenários continuam
pendentes antes de fechar o gate global.

## 2026-07-24 - Revisão da Fase D

### Documentos consultados

Direção oficial, princípios de corrida, Relatório da Expedição, arquitetura,
modelo de dados, fluxos, ADR-030/031, testes, bugs e relatório da Fase C.

### Arquivos analisados

`MapScreen`, tracking canônico, autosave, recovery, `sync.js`,
`runDeferredTaskQueueService`, repository da fila e testes relacionados.

### Resultado

Classificação: Alinhado

O núcleo implementa save mínimo local-first, lock fora da UI, liberação da
interface antes do trabalho derivado, resultados modulares e reconciliação no
startup sem duplicar fila ou alterar o pipeline de GPS.

### Problemas encontrados

Os testes estruturais antigos ainda procuravam diagnósticos e checkpoint dentro
da `MapScreen`; foram atualizados para validar o novo limite arquitetural.

### Riscos

O Samsung SM-A546E autorizou ADB e abriu o Dev Client, mas a matriz de corrida
ativa não foi executada. `RunSummaryModal` e `RunDetailScreen` ainda não
apresentam os módulos; desafios/recompensas seguem `not_applicable`.

### Melhorias sugeridas

Executar a matriz física, instrumentar duração real do save mínimo e iniciar a
Fase 3 adaptando as experiências existentes ao contrato, sem criar terceira tela.

### Documentação atualizada

Arquitetura, dados, fluxo, roadmap, backlog, ADRs, testes, bugs, diagnóstico,
produto, changelog e auditoria da fase.

### Ações recomendadas

Autorizar ADB no aparelho, validar interrupção em cada etapa e manter a Fase 3
atrás de rollout reversível.

## 2026-07-24 - Revisão da direção oficial

### Documentos consultados

README, fontes, visão, roadmap, backlog, arquitetura, dados, fluxos, padrões, ADRs,
design, negócio, deploy, testes, bugs, IA, corrida, background, offline,
diagnóstico, Sentry, zonas, ranking, replay, share e finalização.

### Arquivos analisados

`MapScreen`, tracking canônico/headless, recovery, notificação, sync, repositories,
fila pós-corrida, território, progressão, ranking, resumo, detalhe, replay, share,
social e diagnósticos. A referência `main` foi consultada sem alteração.

### Resultado

Classificação: Parcialmente alinhado

### Problemas encontrados

- UX ativa ainda centraliza mapa/captura;
- finalização ainda é orquestrada no componente;
- pós-corrida fragmentado e sem contrato persistente;
- documentação histórica contradizia produto e código;
- não há flags/entitlements/providers comerciais.

### Riscos

Validação física pendente, bug de reentrada/finalização, caminhos legados e regra
territorial divergente.

### Melhorias sugeridas

Seguir as fases do roadmap: segurança, finalização/pipeline, modo foco, relatório,
retenção, planos e somente depois ecossistema comercial.

### Documentação atualizada

- `AGENTS.md`
- `docs/product/`
- `docs/architecture/`
- documentos operacionais e históricos afetados.

### Ações recomendadas

Não alterar produção antes de concluir a matriz física da Fase C e desenhar o
contrato incremental da Fase D.

## 2026-06-03 - Revisao da corrida offline com sincronizacao automatica

### Documentos consultados

- [[00-fontes-do-projeto]]
- [[01-visao-do-produto]]
- [[02-roadmap]]
- [[03-backlog]]
- [[04-arquitetura]]
- [[10-regras-de-negocio]]
- [[14-instrucoes-para-ia]]
- [[15-workflow-obsidian-ia]]
- [[00-index]]
- [[02-mvp]]
- [[03-mecanica-territorios]]
- [[04-regras-corrida]]
- [[05-gps-e-validacao]]
- [[06-xp-nivel-ranking]]
- [[08-firebase-firestore]]
- [[09-arquitetura-tecnica]]
- [[10-decisoes-do-projeto]]
- [[13-problemas-conhecidos]]

### Arquivos analisados

- `src/screens/MapScreen.js`
- `src/utils/sync.js`
- `src/services/runOfflineStorageService.js`
- `src/screens/Runs/CorridasScreen.js`
- `src/services/territory/territoryCaptureService.js`
- `src/services/tracking/trackingPathService.js`

### Resultado

Classificacao: Alinhado

A implementacao torna a corrida ativa offline-first, salva corridas finalizadas localmente com status pendente e adia Firestore para sincronizacao posterior.

### Problemas encontrados

- `docs/wayper` nao existia originalmente na branch `develop`; os documentos canonicos necessarios foram sincronizados antes da implementacao.

### Riscos

- Coleta em segundo plano ainda precisa de teste real em dispositivos.
- AsyncStorage pode exigir migracao para SQLite/Expo SQLite se corridas longas gerarem volume alto de pontos.

### Melhorias sugeridas

- Criar teste manual de rua para perda de conexao, fechamento do app, retomada e sincronizacao posterior.
- Avaliar SQLite quando houver dados reais de volume e performance.

### Documentacao atualizada

- [[03-backlog]]
- [[08-decisoes-tecnicas]]
- [[18-changelog-produto]]
- [[04-regras-corrida]]
- [[05-gps-e-validacao]]
- [[08-firebase-firestore]]
- [[09-arquitetura-tecnica]]
- [[10-decisoes-do-projeto]]
- [[13-problemas-conhecidos]]

### Acoes recomendadas

- Testar no Android com corrida real e alternancia de rede.
- Validar recuperacao ao fechar/reabrir o app durante corrida ativa, pausada e finalizada antes de salvar resumo.

## 2026-05-27 - Revisão do workflow Obsidian + IA

### Documentos consultados

- [[00-fontes-do-projeto]]
- [[01-visao-do-produto]]
- [[02-roadmap]]
- [[03-backlog]]
- [[04-arquitetura]]
- [[10-regras-de-negocio]]
- [[00-index]]
- [[02-mvp]]
- [[03-mecanica-territorios]]
- [[04-regras-corrida]]
- [[05-gps-e-validacao]]
- [[06-xp-nivel-ranking]]
- [[08-firebase-firestore]]
- [[09-arquitetura-tecnica]]
- [[10-decisoes-do-projeto]]

### Arquivos analisados

- `AGENTS.md`
- `CLAUDE.md`
- `docs/00-fontes-do-projeto.md`
- `docs/03-backlog.md`
- `docs/08-decisoes-tecnicas.md`
- `docs/10-regras-de-negocio.md`
- `docs/13-bugs-conhecidos.md`
- `docs/14-instrucoes-para-ia.md`
- `docs/15-workflow-obsidian-ia.md`
- `docs/16-ideias-de-melhoria.md`
- `docs/17-propostas-pendentes.md`
- `docs/18-changelog-produto.md`
- `docs/20-backlog-ia.md`
- `docs/21-exemplos-de-comandos-ia.md`
- `docs/templates/`

### Resultado

Classificação: Alinhado

### Problemas encontrados

Nenhum problema bloqueante encontrado na revisão documental inicial.

### Riscos

- A existência de duas camadas documentais exige disciplina: `docs/wayper` para regras canônicas e `/docs` para operação, comunicação e registros de IA.
- Propostas futuras podem ficar espalhadas se os gatilhos oficiais não forem usados.

### Melhorias sugeridas

- Revisar periodicamente propostas pendentes e mover decisões aprovadas para os documentos canônicos.
- Criar rotina de revisão mensal do backlog de IA.

### Documentação atualizada

- [[14-instrucoes-para-ia]]
- [[15-workflow-obsidian-ia]]
- [[18-changelog-produto]]

### Ações recomendadas

- Usar os gatilhos oficiais no chat.
- Aprovar explicitamente propostas antes de pedir implementação.
- Rodar revisão documental quando houver mudança grande no app.

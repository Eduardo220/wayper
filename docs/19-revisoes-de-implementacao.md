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

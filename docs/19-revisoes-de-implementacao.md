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

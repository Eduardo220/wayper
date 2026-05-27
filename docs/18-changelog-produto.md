# Changelog do Produto

Este arquivo registra mudanças feitas no app e na documentação operacional do produto.

## Formato obrigatório

```md
## YYYY-MM-DD - Título da alteração

Status:
Origem:
Área:

### O que mudou

### Por que mudou

### Impacto no usuário

### Impacto técnico

### Documentos relacionados

### Arquivos alterados

### Riscos restantes
```

## 2026-05-27 - Configuração do workflow Obsidian + IA

Status: Implementado na documentação
Origem: Solicitação humana
Área: Documentação, workflow de IA, governança do produto

### O que mudou

Foi criado o fluxo documental para que ideias, melhorias, problemas, features, revisões, implementações e sincronizações sejam analisadas contra a documentação antes de virar código.

### Por que mudou

A Wayper precisa de um cérebro vivo em Markdown para alinhar humano, Codex, Claude e outras IAs em torno da mesma visão, decisões e prioridades.

### Impacto no usuário

Sem impacto direto no usuário final neste momento. Impacto indireto esperado: menos mudanças desalinhadas e mais consistência nas futuras implementações.

### Impacto técnico

Não houve alteração de código, dependências, build ou testes. O impacto é processual: futuras mudanças passam a exigir análise, registro, aprovação quando necessário, changelog e revisão.

### Documentos relacionados

- [[00-fontes-do-projeto]]
- [[14-instrucoes-para-ia]]
- [[15-workflow-obsidian-ia]]
- [[16-ideias-de-melhoria]]
- [[17-propostas-pendentes]]
- [[19-revisoes-de-implementacao]]

### Arquivos alterados

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
- `docs/19-revisoes-de-implementacao.md`
- `docs/20-backlog-ia.md`
- `docs/21-exemplos-de-comandos-ia.md`
- `docs/templates/`

### Riscos restantes

- O humano ainda precisa aprovar propostas explicitamente.
- A documentação em `docs/wayper` e `/docs` precisa continuar sincronizada quando regras de produto mudarem.

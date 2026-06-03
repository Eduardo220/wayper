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

## 2026-06-03 - Corrida offline com sincronização pendente

Status: Implementado
Origem: Solicitação humana
Área: Corrida, GPS, histórico, sincronização, Firestore

### O que mudou

Foi implementada uma camada local para persistir a corrida ativa, recuperar corridas interrompidas e salvar corridas finalizadas no histórico local com status de sincronização pendente.

### Por que mudou

A Wayper precisa garantir que uma corrida não seja perdida por falta de internet, fechamento do app ou falha antes da sincronização remota.

### Impacto no usuário

O usuário pode continuar correndo sem internet, pausar/retomar/finalizar offline e ver a corrida no histórico local enquanto a sincronização com Firestore fica pendente.

### Impacto técnico

- `runOfflineStorageService` persiste estado ativo/finalizado localmente.
- `MapScreen` grava snapshots de corrida ativa, restaura atividade ao reabrir e adia Firestore durante a corrida.
- `sync.js` usa status de sincronização e NetInfo para retry automático quando a conexão volta.
- O histórico mostra badge de corrida pendente, sincronizando ou com falha.
- Cálculo territorial pode persistir localmente e adiar envio remoto.

### Documentos relacionados

- [[04-regras-corrida]]
- [[05-gps-e-validacao]]
- [[08-firebase-firestore]]
- [[09-arquitetura-tecnica]]
- [[10-decisoes-do-projeto]]
- [[13-problemas-conhecidos]]

### Arquivos alterados

- `src/services/runOfflineStorageService.js`
- `src/services/__tests__/runOfflineStorageService.test.js`
- `src/screens/MapScreen.js`
- `src/screens/Runs/CorridasScreen.js`
- `src/utils/sync.js`
- `src/services/territory/territoryCaptureService.js`
- `docs/03-backlog.md`
- `docs/08-decisoes-tecnicas.md`
- `docs/wayper/04-regras-corrida.md`
- `docs/wayper/05-gps-e-validacao.md`
- `docs/wayper/08-firebase-firestore.md`
- `docs/wayper/09-arquitetura-tecnica.md`
- `docs/wayper/10-decisoes-do-projeto.md`
- `docs/wayper/13-problemas-conhecidos.md`

### Riscos restantes

- Validar em teste real de rua a coleta em segundo plano em Android/iOS.
- Monitorar volume de pontos no AsyncStorage; migrar para SQLite/Expo SQLite se atividades longas ficarem pesadas.

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

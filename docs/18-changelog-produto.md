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

## 2026-07-24 - Núcleo de finalização e pipeline da Expedição

Status: Implementado, validado localmente e com smoke físico básico; matriz de
corrida Android pendente

Origem: Solicitação humana — Fase D

Área: Corrida, finalização, offline, pós-corrida e arquitetura

### O que mudou

- freeze, lock e salvamento mínimo saíram da `MapScreen` para
  `runFinalizationService`;
- o registro mínimo em `runs` passou a ter contrato e seed versionados;
- a interface é liberada antes da criação e execução das tarefas derivadas;
- a fila existente evoluiu para persistir resultados e estado por módulo;
- o startup reconcilia corridas mínimas pendentes sem criar fila paralela.

### Por que mudou

Para garantir que território, XP, ranking, social e sync não sejam parte da
transação crítica da corrida e para preparar o Relatório da Expedição reabrível.

### Impacto no usuário

A corrida é confirmada localmente antes do trabalho derivado. Uma interrupção
entre a confirmação e a fila pode ser reconciliada na próxima abertura. Ainda não
há uma nova interface visual do Relatório da Expedição.

### Impacto técnico

- `minimumSavedRunVersion=1`;
- `expeditionProcessingVersion=1`;
- fila local preservada em `wayper_run_deferred_tasks_v1`, schema 2;
- resultados legíveis por módulo via repository existente;
- Firestore continua fora do caminho crítico.

### Documentos relacionados

- `docs/architecture/adrs-direcao-oficial.md`;
- `docs/04-arquitetura.md`;
- `docs/05-modelo-de-dados.md`;
- `docs/product/08-relatorio-da-expedicao.md`;
- `docs/audits/2026-07-24-fase-d-finalizacao-expedicao.md`.

### Arquivos alterados

Serviços/repository de finalização e fila, `MapScreen`, testes de contrato e
documentação correspondente.

### Riscos restantes

- validação Android física continua pendente;
- o smoke em aparelho cobriu apenas instalação, bootstrap e carga do bundle;
- resumo/detalhe ainda não renderizam o contrato modular;
- desafios e recompensas continuam fora de escopo;
- processamento local existente ainda precisa medição com históricos longos.

## 2026-07-24 - Direção oficial de produto, negócio e arquitetura

Status: Implementado na documentação; código de produção inalterado

Origem: Solicitação humana

Área: Produto, arquitetura, negócio, IA e planejamento

### O que mudou

- “a corrida é a ação; o pós-corrida é o jogo” passou a ser regra permanente;
- `AGENTS.md` e `docs/product/` consolidam visão, princípios, planos, parcerias,
  anúncios, Expedição, economia, decisões, hipóteses e critérios;
- ADRs formalizam tracking, save mínimo, pipeline, monetização, providers, flags,
  recompensas e ads;
- README, roadmap, backlog, arquitetura, dados, fluxos, UX, negócio, deploy, testes
  e documentos históricos foram reconciliados.

### Por que mudou

Para posicionar a Wayper como plataforma de exercício gamificada, preservar a
atividade segura e tornar o pós-corrida a principal experiência de descoberta.

### Impacto no usuário

Nenhum comportamento foi alterado nesta fase. As próximas entregas passam a ter
limites claros de segurança, experiência e monetização.

### Impacto técnico

Nenhum código, dependência ou schema de produção mudou. Foram definidos contratos
planejados e a evolução da fila existente, sem criar implementação paralela.

### Documentos relacionados

- `AGENTS.md`
- `docs/product/README.md`
- `docs/architecture/adrs-direcao-oficial.md`
- `docs/audits/2026-07-24-direcao-oficial-produto.md`

### Arquivos alterados

Consultar o commit da Fase B e a revisão de 2026-07-24.

### Riscos restantes

- validação Android física da corrida;
- finalização ainda orquestrada em `MapScreen`;
- relatório e seus schemas ainda planejados;
- regra territorial competitiva pendente;
- integrações comerciais não implementadas nem autorizadas.

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

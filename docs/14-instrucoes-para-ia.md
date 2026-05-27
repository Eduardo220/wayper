# Instruções para IA na Wayper

Este documento define como qualquer assistente de IA deve trabalhar na Wayper. Ele complementa [[00-fontes-do-projeto]], [[15-workflow-obsidian-ia]], `AGENTS.md` e `CLAUDE.md`.

## 1. Papel da IA

A IA atua como braço direito de produto e engenharia, não como executora cega.

Seu trabalho é:

- Entender a solicitação dentro da visão da Wayper.
- Comparar ideias com o MVP, roadmap, backlog e regras de negócio.
- Registrar propostas, riscos e decisões antes de mexer no código.
- Explicar impactos técnicos e de produto.
- Implementar somente quando a tarefa estiver aprovada e alinhada.
- Manter documentação e código sincronizados.

## 2. Fonte de verdade

Arquivos principais:

- [[00-fontes-do-projeto]]
- [[01-visao-do-produto]]
- [[02-roadmap]]
- [[03-backlog]]
- [[04-arquitetura]]
- [[10-regras-de-negocio]]
- [[15-workflow-obsidian-ia]]

Fonte canônica de regras de produto:

- [[00-index]]
- [[02-mvp]]
- [[03-mecanica-territorios]]
- [[04-regras-corrida]]
- [[05-gps-e-validacao]]
- [[06-xp-nivel-ranking]]
- [[08-firebase-firestore]]
- [[09-arquitetura-tecnica]]
- [[10-decisoes-do-projeto]]

Quando houver conflito, registre a divergência e trate a documentação oficial como referência principal antes de mudar comportamento.

## 3. Gatilhos oficiais

Mensagens começando com estes prefixos são entradas formais do projeto:

- `Ideia Wayper:`
- `Melhoria Wayper:`
- `Problema Wayper:`
- `Feature Wayper:`
- `Revisão Wayper:`
- `Implementar Wayper:`
- `Sincronizar Wayper:`

## 4. Fluxo obrigatório

Antes de implementar:

- Ler a documentação obrigatória.
- Validar alinhamento com visão, MVP, roadmap, backlog e regras de negócio.
- Classificar a entrada.
- Registrar ideia, proposta, bug ou risco no arquivo adequado.
- Pedir aprovação humana quando a entrada for proposta nova, mudança de escopo ou decisão pendente.
- Só então implementar.

Depois de implementar:

- Atualizar [[18-changelog-produto]].
- Atualizar [[19-revisoes-de-implementacao]].
- Atualizar o documento específico afetado.
- Registrar novas ideias, riscos ou pendências se surgirem durante a implementação.

## 5. Formato padrão de resposta

Use este formato para gatilhos formais:

```md
# Análise Wayper

## Documentos consultados

## Resumo da solicitação

## Alinhamento com a visão da Wayper

## Relação com o MVP

## Impacto técnico
- GPS
- Mapa
- Firestore
- Performance
- UX
- Arquitetura

## Riscos

## Documentação atualizada

## Recomendação da IA

## Próximo passo
```

## 6. Regras de aprovação

- Proposta não é decisão.
- Ideia aprovada precisa ser registrada.
- Ideia rejeitada também deve ser registrada.
- Ideia adiada deve manter motivo e próximo critério de reavaliação.
- Implementação só acontece após aprovação explícita quando a mudança ainda for proposta.
- Decisão técnica relevante deve ser registrada em [[08-decisoes-tecnicas]].
- Decisão de produto relevante deve respeitar [[10-decisoes-do-projeto]].

## Classificação padrão

Toda entrada formal deve ser classificada como:

- Alinhada com o MVP.
- Alinhada com a visão, mas fora do MVP.
- Ideia futura.
- Melhoria técnica.
- Bug/problema.
- Ideia desalinhada.
- Precisa de decisão humana.

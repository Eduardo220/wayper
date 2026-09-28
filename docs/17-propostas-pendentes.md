# Propostas Pendentes

Este arquivo guarda propostas que precisam de decisao do Eduardo antes de qualquer implementacao. Proposta nao e decisao oficial, nao e backlog ativo e nao pode ser executada automaticamente pela IA.

## Convencao de status

- `PENDENTE_DECISÃO`: precisa de decisao do Eduardo.
- `AGUARDANDO_VALIDAÇÃO_EDU`: alternativa equivalente quando a proposta ainda esta sendo avaliada.
- `APROVADO`: Eduardo aprovou.
- `EM_IMPLEMENTAÇÃO`: implementacao aprovada esta em andamento.
- `IMPLEMENTADO`: proposta virou entrega concluida.
- `EM_VALIDAÇÃO`: entregue, mas ainda precisa validacao.
- `REJEITADO`: Eduardo rejeitou ou descartou com motivo.
- `ADIADO`: reconhecida, mas fora da rodada atual.
- `BLOQUEADO`: depende de contexto externo antes da decisao.

Quando for necessario manter ASCII, `PENDENTE_DECISAO` e equivalente operacional de `PENDENTE_DECISÃO`.

## Modelo para registrar uma proposta

```md
### PROP-YYYYMMDD-001 - Titulo curto

- ID: PROP-YYYYMMDD-001
- Titulo:
- Tipo: bug | feature | refactor | UX | arquitetura | teste
- Motivo:
- Escopo:
- Fora de escopo:
- Arquivos provaveis:
- Impacto:
- Risco:
- Criterios de aceite:
- Decisao necessaria do Eduardo:
- Status: PENDENTE_DECISÃO
- Data: YYYY-MM-DD
```

## Propostas aguardando decisao

Nenhuma proposta pendente registrada nesta rodada.

## Propostas aprovadas

Nenhuma proposta aprovada registrada neste arquivo no momento.

## Propostas rejeitadas

Nenhuma proposta rejeitada registrada neste arquivo no momento.

## Propostas convertidas em tarefa

Nenhuma proposta convertida em tarefa registrada neste arquivo no momento.

## Como usar

- Use este arquivo quando a ideia ja tiver escopo, criterio de aceite e uma decisao clara a ser tomada.
- Se ainda for exploratorio, registre primeiro em `docs/16-ideias-de-melhoria.md`.
- Se for grande, de medio/longo prazo ou depender de backend/sync remoto/validacao real, registre ou conecte tambem em `docs/wayper/12-ideias-futuras.md`.
- Se a proposta virar decisao tecnica, registre tambem em `docs/08-decisoes-tecnicas.md` ou `docs/wayper/10-decisoes-do-projeto.md`, conforme o dominio.
- Se a proposta afetar produto, GPS, territorio, ranking, Firestore, local-first, permissao, diagnostico ou UX critica, valide contra os docs de dominio antes de implementar.
- Nao remova proposta pendente sem registrar decisao, data e motivo.
- Nao mova proposta para aprovada sem aprovacao explicita do Eduardo.
- Nao implemente proposta aprovada automaticamente; implemente apenas quando Eduardo pedir a rodada de execucao.

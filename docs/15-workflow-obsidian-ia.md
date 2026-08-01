# Workflow Obsidian + IA da Wayper

> **Status:** vigente como fluxo complementar<br>
> **Tipo:** fonte operacional auxiliar<br>
> **Escopo:** registro de ideias, propostas, bugs e revisões em Markdown<br>
> **Última revisão:** 2026-08-01<br>
> **Fonte principal relacionada:** [`docs/14-instrucoes-para-ia.md`](14-instrucoes-para-ia.md)

Este é um workflow complementar para usar Markdown e Obsidian como memória
operacional. As regras canônicas estão em `AGENTS.md`,
`docs/00-fontes-do-projeto.md`,
`docs/product/direcao-estrategica-completa.md` e
`docs/14-instrucoes-para-ia.md`; este arquivo não mantém outra versão delas.

## Ciclo de trabalho

1. Entrada de ideia, bug, proposta ou tarefa no chat.
2. IA consulta codigo atual, documentacao e registros existentes.
3. IA classifica a entrada.
4. IA registra no arquivo adequado quando necessario.
5. Eduardo aprova, rejeita ou adia.
6. IA implementa somente se houver pedido/aprovacao explicita.
7. IA atualiza documentacao afetada.
8. IA registra changelog/revisao quando a rodada pedir.
9. IA registra riscos, bugs ou validacoes pendentes.
10. IA sugere melhorias futuras relacionadas, sem executa-las automaticamente.

## Regras centrais

- Nada entra no codigo sem passar pela documentacao quando a mudanca for relevante.
- Nada muda no codigo sem atualizar a documentacao afetada.
- Toda ideia deve ter status.
- Toda decisao importante deve ter registro.
- Toda mudanca grande deve gerar changelog quando fizer parte da rodada.
- Toda implementacao relevante deve gerar revisao ou resumo rastreavel.
- Toda proposta nova precisa de aprovacao explicita do Eduardo antes de virar implementacao.
- Ideia nova pode ser registrada e organizada pela IA, mas nao pode virar backlog ativo nem implementacao sem decisao do Eduardo.
- Uma oportunidade de melhoria relacionada pode ser registrada em
  `docs/16-ideias-de-melhoria.md` quando fizer parte do escopo; isso não autoriza
  ampliar a tarefa nem cria obrigação paralela às fontes canônicas.
- A fundação prioriza tracking/GPS confiável, background, tela apagada, offline,
  persistência local, recovery, finalização resiliente, diagnóstico e validação
  Android física antes de expansão pós-corrida ou comercial.

## Tabela de registro

| Tipo de entrada | Onde registrar | Pode implementar direto? |
| --- | --- | --- |
| Ideia nova | `docs/16-ideias-de-melhoria.md` | Nao |
| Proposta concreta | `docs/17-propostas-pendentes.md` | Nao |
| Bug | `docs/13-bugs-conhecidos.md` | So com pedido/aprovacao explicita |
| Ideia futura/longo prazo | `docs/wayper/12-ideias-futuras.md` | Nao |
| Mudanca aprovada | `docs/18-changelog-produto.md` | Sim, apos aprovacao e pedido de execucao |
| Revisao pos-codigo | `docs/19-revisoes-de-implementacao.md` | Nao |
| Tarefa operacional aprovada | `docs/20-backlog-ia.md` | Somente apos decisao do Eduardo |

## Como classificar uma entrada

Use estas categorias:

- Alinhada com o MVP.
- Alinhada com a visao, mas fora do MVP.
- Ideia futura.
- Melhoria tecnica.
- Bug/problema.
- Ideia desalinhada.
- Precisa de decisao do Eduardo.

## Onde registrar

- Ideias exploratorias: `docs/16-ideias-de-melhoria.md`
- Propostas que pedem aprovacao: `docs/17-propostas-pendentes.md`
- Ideias futuras/medio e longo prazo: `docs/wayper/12-ideias-futuras.md`
- Decisoes tecnicas: `docs/08-decisoes-tecnicas.md`
- Decisões de produto vigentes: `docs/product/10-decisoes-aprovadas.md`
- Memória de decisões em `docs/wayper`: `docs/wayper/10-decisoes-do-projeto.md`
- Regras de negocio: `docs/10-regras-de-negocio.md`
- Bugs e riscos: `docs/13-bugs-conhecidos.md`
- Changelog apos implementacao: `docs/18-changelog-produto.md`
- Revisoes pos-codigo: `docs/19-revisoes-de-implementacao.md`
- Tarefas sugeridas pela IA, quando aprovadas: `docs/20-backlog-ia.md`
- Exemplos de comandos: `docs/21-exemplos-de-comandos-ia.md`

## Criterio para implementar

A IA pode implementar somente quando:

- A solicitacao foi comparada com a documentacao.
- A proposta foi registrada quando necessario.
- A decisao do Eduardo esta explicita.
- O impacto em produto, MVP, GPS, mapa, Firestore, performance, UX, arquitetura, custo, seguranca e complexidade foi analisado.
- A documentacao que sera afetada esta identificada.
- Ideias pendentes continuam registradas como ideias/propostas, nao como entrega implementada.

## Criterio depois de implementar

Toda implementacao deve deixar rastros uteis:

- Documento de dominio atualizado.
- Changelog atualizado quando aplicavel.
- Revisao pos-codigo atualizada quando aplicavel.
- Riscos ou bugs novos registrados em `docs/13-bugs-conhecidos.md`.
- Ideias futuras registradas em `docs/16-ideias-de-melhoria.md` ou `docs/wayper/12-ideias-futuras.md`.
- Propostas de proxima tarefa registradas em `docs/17-propostas-pendentes.md` quando exigirem decisao do Eduardo.
- Testes e validacao manual documentados.
- Diferenca clara entre implementado, pendente, em validacao e sugestao.

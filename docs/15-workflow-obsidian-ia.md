# Workflow Obsidian + IA da Wayper

Este é o fluxo central para usar Obsidian, Markdown e assistentes de IA como cérebro vivo da Wayper.

## Ciclo de trabalho

1. Entrada de ideia no chat.
2. IA consulta documentação.
3. IA classifica a ideia.
4. IA registra no arquivo adequado.
5. Humano aprova, rejeita ou adia.
6. IA implementa, se aprovado.
7. IA atualiza documentação.
8. IA registra changelog.
9. IA registra revisão.
10. IA sugere melhorias futuras.

## Regras centrais

- Nada entra no código sem passar pela documentação.
- Nada muda no código sem atualizar a documentação.
- Toda ideia deve ter status.
- Toda decisão importante deve ter registro.
- Toda mudança grande deve gerar changelog.
- Toda implementação deve gerar revisão.
- Toda proposta nova precisa de aprovação humana explícita antes de virar implementação.
- O MVP continua priorizando corrida real, GPS confiável, histórico, zonas, ranking simples, segurança do Firestore e UX de localização.

## Tabela de registro

| Tipo de entrada | Onde registrar | Pode implementar direto? |
| --- | --- | --- |
| Ideia nova | docs/16-ideias-de-melhoria.md ([[16-ideias-de-melhoria]]) | Não |
| Proposta concreta | docs/17-propostas-pendentes.md ([[17-propostas-pendentes]]) | Não |
| Bug | docs/13-bugs-conhecidos.md ([[13-bugs-conhecidos]]) | Só com aprovação |
| Mudança aprovada | docs/18-changelog-produto.md ([[18-changelog-produto]]) | Sim, após aprovação |
| Revisão pós-código | docs/19-revisoes-de-implementacao.md ([[19-revisoes-de-implementacao]]) | Não |
| Tarefa futura | docs/20-backlog-ia.md ([[20-backlog-ia]]) | Não |

## Como classificar uma entrada

Use estas categorias:

- Alinhada com o MVP.
- Alinhada com a visão, mas fora do MVP.
- Ideia futura.
- Melhoria técnica.
- Bug/problema.
- Ideia desalinhada.
- Precisa de decisão humana.

## Onde registrar

- Ideias exploratórias: [[16-ideias-de-melhoria]]
- Propostas que pedem aprovação: [[17-propostas-pendentes]]
- Decisões técnicas: [[08-decisoes-tecnicas]]
- Regras de negócio: [[10-regras-de-negocio]]
- Bugs e riscos: [[13-bugs-conhecidos]]
- Changelog após implementação: [[18-changelog-produto]]
- Revisões pós-código: [[19-revisoes-de-implementacao]]
- Tarefas sugeridas pela IA: [[20-backlog-ia]]
- Exemplos de comandos: [[21-exemplos-de-comandos-ia]]

## Critério para implementar

A IA pode implementar somente quando:

- A solicitação foi comparada com a documentação.
- A proposta foi registrada quando necessário.
- A decisão humana está explícita.
- O impacto em produto, MVP, GPS, mapa, Firestore, performance, UX, arquitetura, custo, segurança e complexidade foi analisado.
- A documentação que será afetada está identificada.

## Critério depois de implementar

Toda implementação deve deixar rastros úteis:

- Documento de domínio atualizado.
- [[18-changelog-produto]] atualizado.
- [[19-revisoes-de-implementacao]] atualizado.
- Riscos ou bugs novos registrados em [[13-bugs-conhecidos]].
- Ideias futuras registradas em [[16-ideias-de-melhoria]] ou [[20-backlog-ia]].

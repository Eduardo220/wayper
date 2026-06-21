# Fontes do Projeto Wayper

Este diretório centraliza as fontes oficiais de contexto do Wayper para desenvolvimento, manutenção e uso com assistentes de IA.

## Ordem de prioridade das fontes

1. Código atual na branch `develop`.
2. Código estável na branch `main`.
3. `README.md` do repositório.
4. Documentação em `/docs`.
5. Issues, pull requests e decisões registradas no GitHub.
6. Conversas e anotações externas, somente quando não contradizem o código ou a documentação.

## Papel do Obsidian e dos Markdown

- O codigo atual em `develop` continua sendo a fonte da verdade implementada.
- Os Markdown em `/docs` e `docs/wayper` sao a memoria do projeto no Obsidian: registram intencao, planejamento, historico, decisoes, bugs, propostas, ideias e riscos.
- Quando codigo e docs divergirem, valide o codigo atual primeiro e atualize a documentacao relevante em vez de criar uma narrativa paralela.
- Conversas externas, mensagens soltas e conhecimento geral so valem se nao contradizem o codigo e os documentos oficiais.
- Propostas novas precisam de validacao do Eduardo antes de entrarem como implementacao, backlog ativo ou decisao aprovada.
- Ideias registradas pela IA devem ficar como sugestao ate Eduardo aprovar, rejeitar ou pedir uma proxima tarefa.

## Branches oficiais

| Branch | Uso |
| --- | --- |
| `develop` | Desenvolvimento ativo do app, testes e mudanças em andamento. |
| `main` | Versão oficial/estável do app. Deve receber mudanças somente após validação. |

## Fontes criadas

| Fonte | Arquivo |
| --- | --- |
| Visão do produto | `docs/01-visao-do-produto.md` |
| Roadmap | `docs/02-roadmap.md` |
| Backlog | `docs/03-backlog.md` |
| Arquitetura | `docs/04-arquitetura.md` |
| Modelo de dados | `docs/05-modelo-de-dados.md` |
| Fluxos de usuário | `docs/06-fluxos-de-usuario.md` |
| Padrões de código | `docs/07-padroes-de-codigo.md` |
| Decisões técnicas | `docs/08-decisoes-tecnicas.md` |
| Design e wireframes | `docs/09-design-e-wireframes.md` |
| Regras de negócio | `docs/10-regras-de-negocio.md` |
| Deploy | `docs/11-plano-de-deploy.md` |
| Testes | `docs/12-guia-de-testes.md` |
| Bugs conhecidos | `docs/13-bugs-conhecidos.md` |
| Instruções para IA | `docs/14-instrucoes-para-ia.md` |
| Workflow Obsidian + IA | `docs/15-workflow-obsidian-ia.md` |
| Ideias de melhoria | `docs/16-ideias-de-melhoria.md` |
| Propostas pendentes | `docs/17-propostas-pendentes.md` |
| Ideias futuras | `docs/wayper/12-ideias-futuras.md` |
| Onboarding, permissoes e estados vazios | `docs/23-onboarding-permissoes-estados-vazios.md` |
| Resumo da rodada local-first | `docs/24-resumo-rodada-local-first.md` |

## Como manter isso útil

- Toda mudança grande no app deve atualizar pelo menos um documento desta pasta.
- Toda decisão técnica relevante deve ser registrada em `docs/08-decisoes-tecnicas.md` ou em ADRs futuros.
- Documentação desatualizada deve ser corrigida ou marcada como pendente.
- Quando houver conflito entre documentacao antiga e codigo atual da branch `develop`, valide o codigo primeiro e atualize a documentacao.
- Para o estado local-first consolidado em 2026-06-19, use `docs/24-resumo-rodada-local-first.md` como mapa rapido antes de aprofundar nos documentos especificos.
- Para o protocolo "Obsidian como mente do projeto", use `docs/14-instrucoes-para-ia.md` como regra operacional e preserve a diferenca entre implementado, em validacao, pendente de decisao, ideia futura, bug conhecido, proposta aprovada e proposta rejeitada.
- Nao mova ideia para backlog ativo, changelog de implementacao ou decisao aprovada sem validacao explicita do Eduardo.

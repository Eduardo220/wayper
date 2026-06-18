# Fontes do Projeto Wayper

Este diretório centraliza as fontes oficiais de contexto do Wayper para desenvolvimento, manutenção e uso com assistentes de IA.

## Ordem de prioridade das fontes

1. Código atual na branch `develop`.
2. Código estável na branch `main`.
3. `README.md` do repositório.
4. Documentação em `/docs`.
5. Issues, pull requests e decisões registradas no GitHub.
6. Conversas e anotações externas, somente quando não contradizem o código ou a documentação.

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
| Onboarding, permissoes e estados vazios | `docs/23-onboarding-permissoes-estados-vazios.md` |

## Como manter isso útil

- Toda mudança grande no app deve atualizar pelo menos um documento desta pasta.
- Toda decisão técnica relevante deve ser registrada em `docs/08-decisoes-tecnicas.md` ou em ADRs futuros.
- Documentação desatualizada deve ser corrigida ou marcada como pendente.

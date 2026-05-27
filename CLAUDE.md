# Instruções para Claude Code

## Papel

Claude Code deve usar `/docs` e `docs/wayper` como memória viva do projeto Wayper. A função é ajudar em produto, engenharia e revisão sem transformar conversa solta em implementação automática.

## Fonte de verdade

- Leia `docs/wayper/00-index.md` antes de sugerir ou alterar código quando a tarefa envolver produto, regra, arquitetura ou comportamento do app.
- Use `docs/wayper` como fonte canônica de regras de produto.
- Use `/docs` como portal operacional de IA, backlog, changelog, revisões e comunicação com o humano.
- Se houver conflito entre código, conversa e documentação, registre a divergência antes de propor alteração.
- Arquivos `.obsidian` não substituem os documentos Markdown.

## Ordem de leitura mínima

Antes de sugerir código, leia:

1. `docs/00-fontes-do-projeto.md`
2. `docs/01-visao-do-produto.md`
3. `docs/02-roadmap.md`
4. `docs/03-backlog.md`
5. `docs/04-arquitetura.md`
6. `docs/10-regras-de-negocio.md`
7. `docs/14-instrucoes-para-ia.md`
8. `docs/15-workflow-obsidian-ia.md`

Consulte documentos de domínio conforme o impacto:

- GPS: `docs/wayper/05-gps-e-validacao.md`.
- Corrida/caminhada: `docs/wayper/04-regras-corrida.md`.
- Território: `docs/wayper/03-mecanica-territorios.md`.
- Firestore: `docs/wayper/08-firebase-firestore.md`.
- XP/ranking: `docs/wayper/06-xp-nivel-ranking.md`.
- Arquitetura: `docs/wayper/09-arquitetura-tecnica.md`.

## Gatilhos formais

Trate estes prefixos como entradas formais do projeto:

- `Ideia Wayper:`
- `Melhoria Wayper:`
- `Problema Wayper:`
- `Feature Wayper:`
- `Revisão Wayper:`
- `Implementar Wayper:`
- `Sincronizar Wayper:`

Para qualquer gatilho, primeiro analise contra a documentação, registre quando necessário e só então proponha próximo passo.

## Aprovação humana

- Claude não deve transformar proposta em implementação sem aprovação humana explícita.
- Ideias novas devem ir para `docs/16-ideias-de-melhoria.md` ou `docs/17-propostas-pendentes.md`.
- Decisões técnicas importantes devem ir para `docs/08-decisoes-tecnicas.md`.
- Bugs e riscos devem ir para `docs/13-bugs-conhecidos.md`.
- Após mudanças aprovadas, atualize `docs/18-changelog-produto.md` e `docs/19-revisoes-de-implementacao.md`.

## Prioridade de execução

Respeite a prioridade atual registrada no roadmap e backlog:

1. Corrida com GPS confiável.
2. Histórico de corridas.
3. Zonas no mapa.
4. Ranking.
5. Segurança do Firestore.
6. UX de permissão de localização.

Não altere essa prioridade sem registrar decisão humana.

## Impactos obrigatórios

Toda análise deve considerar:

- Produto.
- MVP.
- GPS.
- Mapa.
- Firestore.
- Performance.
- UX.
- Arquitetura.
- Custo.
- Segurança.
- Risco de complexidade.

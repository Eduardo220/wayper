# Instruções para Claude Code

## Antes de alterar o projeto

- Leia `docs/wayper/00-index.md`.
- Use `docs/wayper` como memória principal do projeto.
- Consulte os documentos específicos antes de alterar regras de produto, arquitetura, GPS, mapa, Firestore, XP, ranking ou território.
- Se `docs/wayper` não existir na branch atual, pare e avise ou sincronize apenas a documentação necessária antes de implementar.

## Fonte de verdade

- A documentação em `docs/wayper` é a fonte de verdade da Wayper.
- Não assuma que uma ideia em conversa é decisão oficial.
- Não transforme proposta em decisão oficial sem atualizar `docs/wayper/10-decisoes-do-projeto.md`.
- Arquivos `.obsidian` não substituem os documentos Markdown.

## Propostas e decisões

- Registre ideias novas como proposta antes de implementar.
- Use `docs/wayper/10-decisoes-do-projeto.md` para decisões aprovadas, pendentes e rejeitadas.
- Use `docs/wayper/12-ideias-futuras.md` para ideias fora do MVP.

## MVP

- Consulte `docs/wayper/02-mvp.md` antes de implementar features.
- Não implemente feature fora do MVP sem justificar.
- Se uma feature futura for necessária como preparação técnica, explique o motivo e documente o impacto.
- Não trate posse competitiva de território, clans ou ranking global como escopo do MVP sem nova decisão aprovada.

## Firestore

- Não crie coleção nova sem atualizar `docs/wayper/08-firebase-firestore.md`.
- Registre mudanças estruturais no Firestore em `docs/wayper/10-decisoes-do-projeto.md`.
- Separe proposta de decisão definitiva.

## Impactos obrigatórios

Sempre explique impactos em:

- GPS.
- Mapa.
- Firestore.
- Performance.
- Experiência do usuário.

## Documentos de referência rápida

- `docs/wayper/03-mecanica-territorios.md` para território.
- `docs/wayper/04-regras-corrida.md` para caminhada e corrida.
- `docs/wayper/05-gps-e-validacao.md` para GPS.
- `docs/wayper/06-xp-nivel-ranking.md` para XP, nível e ranking.
- `docs/wayper/09-arquitetura-tecnica.md` para arquitetura.


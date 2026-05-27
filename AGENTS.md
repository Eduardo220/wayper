# Instruções para agentes Codex

## Fonte de verdade

- Sempre leia `docs/wayper/00-index.md` antes de mexer no código.
- A documentação em `docs/wayper` é a fonte de verdade da Wayper.
- Se houver conflito entre código, conversa e documentação, trate `docs/wayper` como referência principal e registre a divergência antes de alterar comportamento.

## Escopo de implementação

- Não implemente feature fora do MVP sem justificar.
- Consulte `docs/wayper/02-mvp.md` antes de ampliar escopo.
- Se uma regra estiver ausente, crie uma proposta na documentação antes de implementar.
- Não transforme proposta em decisão oficial sem atualizar `docs/wayper/10-decisoes-do-projeto.md`.

## Firestore

- Não crie coleção nova no Firestore sem documentar.
- Atualize `docs/wayper/08-firebase-firestore.md` para qualquer mudança em coleções, documentos, campos, índices relevantes ou agregados.
- Registre decisões relevantes em `docs/wayper/10-decisoes-do-projeto.md`.

## Impactos obrigatórios

Ao propor ou implementar mudanças relevantes, explique impactos em:

- GPS.
- Mapa.
- Firestore.
- Performance.
- Experiência do usuário.

## Mecânicas centrais

- Mudanças de território devem consultar `docs/wayper/03-mecanica-territorios.md`.
- Mudanças em atividade, caminhada ou corrida devem consultar `docs/wayper/04-regras-corrida.md`.
- Mudanças de GPS devem consultar `docs/wayper/05-gps-e-validacao.md`.
- Mudanças de XP, nível ou ranking devem consultar `docs/wayper/06-xp-nivel-ranking.md`.

## Registro de decisões

- Toda mudança importante deve ser registrada em `docs/wayper/10-decisoes-do-projeto.md`.
- Ideias futuras devem entrar em `docs/wayper/12-ideias-futuras.md`.
- Riscos técnicos devem entrar em `docs/wayper/13-problemas-conhecidos.md`.


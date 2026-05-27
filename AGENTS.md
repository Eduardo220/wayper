# Instruções para agentes Codex

## Fonte de verdade

- Antes de qualquer alteração no código, consulte a documentação da Wayper.
- Leia `docs/wayper/00-index.md` antes de mexer no projeto quando a tarefa envolver comportamento do app, produto, regras, arquitetura, GPS, mapa, Firestore, XP, ranking ou território.
- A documentação em `docs/wayper` é a fonte de verdade canônica de produto e regras da Wayper.
- A documentação em `docs` funciona como portal operacional, memória de IA, backlog, changelog, revisões e comunicação com o humano.
- Se houver conflito entre código, conversa e documentação, trate `docs/wayper` como referência principal e registre a divergência antes de alterar comportamento.
- Se `docs/wayper` não existir na branch atual, pare e avise ou sincronize apenas os arquivos de documentação necessários antes de implementar.
- Arquivos `.obsidian` não substituem a documentação Markdown e não devem orientar decisões de produto.

## Ordem de leitura obrigatória

Antes de sugerir ou implementar mudança, leia nesta ordem:

1. `docs/00-fontes-do-projeto.md`
2. `docs/01-visao-do-produto.md`
3. `docs/02-roadmap.md`
4. `docs/03-backlog.md`
5. `docs/04-arquitetura.md`
6. `docs/10-regras-de-negocio.md`
7. `docs/14-instrucoes-para-ia.md`
8. `docs/15-workflow-obsidian-ia.md`

Quando a mudança afetar domínio central, consulte também:

- Território: `docs/wayper/03-mecanica-territorios.md`.
- Atividade, caminhada ou corrida: `docs/wayper/04-regras-corrida.md`.
- GPS: `docs/wayper/05-gps-e-validacao.md`.
- XP, nível ou ranking: `docs/wayper/06-xp-nivel-ranking.md`.
- Firestore: `docs/wayper/08-firebase-firestore.md`.
- Arquitetura técnica: `docs/wayper/09-arquitetura-tecnica.md`.
- Decisões de produto: `docs/wayper/10-decisoes-do-projeto.md`.

## Gatilhos formais do projeto

Trate mensagens que começam com estes gatilhos como entradas formais da Wayper:

- `Ideia Wayper:`
- `Melhoria Wayper:`
- `Problema Wayper:`
- `Feature Wayper:`
- `Revisão Wayper:`
- `Implementar Wayper:`
- `Sincronizar Wayper:`

Para qualquer gatilho, primeiro analise e documente. Só implemente depois que a documentação estiver alinhada e houver aprovação humana explícita quando a entrada for uma proposta nova.

## Regras de aprovação

- Nunca implemente uma proposta nova sem aprovação humana explícita.
- Proposta não é decisão.
- Ideia aprovada precisa estar registrada.
- Ideia rejeitada ou adiada também precisa estar registrada.
- Mudança fora do MVP exige justificativa e registro.
- Não implemente posse competitiva de território, clans ou ranking global como parte do MVP sem nova decisão aprovada.

## Registro obrigatório

- Toda mudança no código deve atualizar a documentação relacionada.
- Toda ideia nova deve ser registrada em `docs/16-ideias-de-melhoria.md` ou `docs/17-propostas-pendentes.md`.
- Toda decisão técnica importante deve ser registrada em `docs/08-decisoes-tecnicas.md`.
- Todo bug ou risco técnico deve ser registrado em `docs/13-bugs-conhecidos.md` ou `docs/wayper/13-problemas-conhecidos.md`, conforme o escopo.
- Toda implementação deve atualizar `docs/18-changelog-produto.md`.
- Toda implementação deve atualizar `docs/19-revisoes-de-implementacao.md`.
- Mudanças no Firestore exigem atualização de `docs/wayper/08-firebase-firestore.md` e registro de decisão relevante.

## Impactos obrigatórios

Ao propor, revisar ou implementar mudanças relevantes, avalie impacto em:

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

## Classificação obrigatória de ideias

Classifique cada ideia como uma destas opções:

- Alinhada com o MVP.
- Alinhada com a visão, mas fora do MVP.
- Ideia futura.
- Melhoria técnica.
- Bug/problema.
- Ideia desalinhada.
- Precisa de decisão humana.

## Formato obrigatório de resposta

Para gatilhos formais da Wayper, responda sempre com:

- Documentos consultados.
- Resumo da ideia.
- Análise de alinhamento.
- Impacto técnico.
- Riscos.
- Documentação atualizada.
- Recomendação da IA.
- Próximo passo sugerido.

## Escopo de implementação

- Não implemente feature fora do MVP sem justificar.
- Consulte `docs/wayper/02-mvp.md` antes de ampliar escopo.
- Se uma regra estiver ausente, crie proposta na documentação antes de implementar.
- Não transforme proposta em decisão oficial sem atualizar `docs/wayper/10-decisoes-do-projeto.md`.

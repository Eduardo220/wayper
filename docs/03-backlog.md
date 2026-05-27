# Backlog

Backlog inicial de funcionalidades, melhorias e pendências. Use issues do GitHub para detalhar e acompanhar execução.

## Alta prioridade

| Item | Tipo | Status | Observação |
| --- | --- | --- | --- |
| Corrida com GPS confiável | Feature | A fazer | Base do produto. |
| Histórico de corridas | Feature | A fazer | Necessário para progresso do usuário. |
| Zonas no mapa | Feature | A fazer | Coração da gamificação. |
| Ranking | Feature | A fazer | Competição básica; ranking global competitivo depende de decisão específica. |
| Regras de segurança do Firestore | Segurança | A validar | Não brincar com dado de usuário, por favor. |
| Tratamento de permissão de localização | UX | A fazer | Usuário nega permissão e o app não pode morrer dramaticamente. |

## Média prioridade

| Item | Tipo | Status | Observação |
| --- | --- | --- | --- |
| Ranking semanal/mensal | Feature | A fazer | Ajuda retenção. |
| Perfil de usuário | Feature | A fazer | Base social. |
| Sistema de amigos | Feature | A fazer | Para competição entre conhecidos. |
| Conquistas | Gamificação | A fazer | Metas e badges. |
| Modo offline parcial | Técnica | A avaliar | Importante para corrida com internet ruim. |
| Cache de mapa/dados | Técnica | A avaliar | Melhorar experiência. |

## Baixa prioridade

| Item | Tipo | Status | Observação |
| --- | --- | --- | --- |
| Temas visuais | UI | Futuro | Depois que o essencial funcionar. |
| Compartilhamento social | Feature | Futuro | Bom para divulgação. |
| Integração com wearables | Feature | Futuro | Complexidade maior. |
| iOS produção | Plataforma | Futuro | Depende de prioridade e recursos. |

## Dívidas técnicas

- Padronizar estrutura de pastas se ainda estiver inconsistente.
- Documentar variáveis de ambiente.
- Criar testes para regras críticas de corrida e zona.
- Revisar nomes de scripts para separar dev, rua, produção e build.
- Criar ADRs para decisões importantes.

## Como priorizar

1. Primeiro, fazer o usuário correr e salvar dados corretamente.
2. Depois, transformar corrida em território.
3. Depois, ranquear e competir.
4. Por último, enfeitar.

## Fluxo de entrada com IA

- Novas ideias sugeridas por IA devem primeiro ir para [[16-ideias-de-melhoria]].
- Propostas concretas que precisam de aprovação devem ir para [[17-propostas-pendentes]].
- Tarefas aprovadas podem entrar neste backlog principal quando fizerem parte da prioridade do produto.
- Tarefas técnicas sugeridas pela IA podem ir para [[20-backlog-ia]] antes de virarem backlog principal.
- Bugs e riscos técnicos devem ser registrados em [[13-bugs-conhecidos]].

## Prioridade atual

A prioridade atual continua sendo:

1. Corrida com GPS confiável.
2. Histórico de corridas.
3. Zonas no mapa.
4. Ranking.
5. Segurança do Firestore.
6. UX de permissão de localização.

Não mude essa prioridade principal sem registrar decisão humana em [[08-decisoes-tecnicas]] quando for decisão técnica, e em [[10-decisoes-do-projeto]] quando afetar produto ou MVP.

# Backlog

Backlog inicial de funcionalidades, melhorias e pendências. Use issues do GitHub para detalhar e acompanhar execução.

## Alta prioridade

| Item | Tipo | Status | Observação |
| --- | --- | --- | --- |
| Corrida com GPS confiável | Feature | A fazer | Base do produto. |
| Histórico de corridas | Feature | A fazer | Necessário para progresso do usuário. |
| Zonas no mapa | Feature | A fazer | Coração da gamificação. |
| Ranking global | Feature | A fazer | Competição básica. |
| Recuperação de corrida após crash | Técnica | Alta prioridade | Autosave local contínuo, recovery assistido e sync idempotente. |
| Regras de segurança do Firestore | Segurança | A validar | Não brincar com dado de usuário, por favor. |
| Tratamento de permissão de localização | UX | A fazer | Usuário nega permissão e o app não pode morrer dramaticamente. |

## Média prioridade

| Item | Tipo | Status | Observação |
| --- | --- | --- | --- |
| Ranking semanal/mensal | Feature | A fazer | Ajuda retenção. |
| Perfil de usuário | Feature | A fazer | Base social. |
| Sistema de amigos | Feature | A fazer | Para competição entre conhecidos. |
| Conquistas | Gamificação | A fazer | Metas e badges. |
| Modo offline parcial | Técnica | Implementação inicial | Corrida ativa offline-first com histórico pendente; validar em teste real de rua. |
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

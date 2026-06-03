# Decisões do projeto

## Como usar

Este arquivo registra decisões importantes da Wayper.

Toda mudança relevante de produto, arquitetura, Firestore, GPS, território, XP, ranking ou fluxo deve ser registrada aqui. Ideias podem começar como propostas, mas só viram decisão oficial quando movidas para "Decisões aprovadas".

## Decisões aprovadas

### A documentação oficial fica em `docs/wayper`

Status: aprovada.

Decisão:

- `docs/wayper` é a fonte de verdade do projeto.
- Mudanças importantes devem atualizar a documentação correspondente.

Motivo:

- Evitar regras espalhadas entre conversas, código e documentos antigos.

### O MVP deve validar caminhada/corrida com conquista de território

Status: aprovada.

Decisão:

- O primeiro MVP deve focar no ciclo de atividade real com GPS, rota, XP, resumo e conquista territorial simples.

Motivo:

- Esse é o núcleo diferencial da Wayper.

### Clans ficam fora do MVP

Status: aprovada.

Decisão:

- Clans serão tratados como ideia futura.

Motivo:

- Clans exigem ranking, convite, moderação, agregados e regras de grupo.

### Território do MVP é progresso individual

Status: aprovada.

Decisão:

- O território no MVP representa progresso individual derivado de atividades válidas.
- O MVP não define posse global, perda de território, disputa em tempo real ou controle compartilhado de áreas.

Motivo:

- Reduz complexidade de GPS, mapa, Firestore, ranking e anti-cheat.
- Mantém o foco na validação do ciclo principal: atividade real, rota, XP, resumo e conquista visível.

### Corrida ativa deve ser offline-first

Status: aprovada.

Decisão:

- Durante a corrida, a fonte principal de verdade é o armazenamento local do app.
- GPS, rota, tempo, pausa, retomada e finalização não devem depender de Firestore ou conexão ativa.
- Firestore deve receber a corrida somente depois que ela estiver salva localmente.
- Corridas finalizadas sem sincronização remota devem aparecer no histórico com status pendente.
- Ao reabrir o app, uma corrida ativa ou finalizada ainda não salva deve ser recuperada a partir do estado local.

Motivo:

- Um app de corrida não pode perder atividade real por oscilação de internet.
- A coleta GPS funciona sem internet e deve permanecer desacoplada do backend durante a atividade.
- A sincronização posterior reduz custo, falhas e acoplamento com Firestore.

## Decisões pendentes

### Estratégia final de território

Status: pendente.

Opções:

- Células de mapa.
- Buffer de rota.
- Zonas predefinidas.
- Modelo híbrido.

Impactos:

- Performance do mapa.
- Custo do Firestore.
- Clareza para o usuário.
- Complexidade de validação.

### Estrutura persistida de território no MVP

Status: pendente.

Opções:

- Salvar apenas resumo territorial na atividade.
- Criar `territoryClaims` para conquistas individuais.
- Criar entidades de território compartilhado somente em fase futura.

Impactos:

- Custo de escrita.
- Facilidade de exibir histórico.
- Migração para disputa futura.
- Complexidade de auditoria.

### Precisão mínima oficial do GPS

Status: pendente.

Proposta inicial:

- Até 25 metros: aceitável.
- Entre 25 e 50 metros: cautela.
- Acima de 50 metros: inválido para território.

Impactos:

- Justiça da conquista.
- Experiência em áreas urbanas densas.
- Quantidade de atividades parcialmente inválidas.

### Armazenamento de rotas

Status: pendente.

Opções:

- Subcoleção de pontos.
- Documento compactado.
- Rota simplificada.
- Armazenamento híbrido.

Impactos:

- Custo do Firestore.
- Performance do histórico.
- Capacidade de auditoria.

### Cálculo de agregados

Status: pendente.

Opções:

- No app.
- Em Cloud Functions.
- Híbrido.

Impactos:

- Consistência.
- Custo.
- Complexidade.
- Segurança contra manipulação.

## Decisões rejeitadas

### Ranking competitivo completo no MVP

Status: rejeitada para o MVP.

Motivo:

- Ranking competitivo exige validação mais forte de GPS e regras anti-fraude.
- Pode distorcer a validação inicial do produto.

### Disputa direta por posse de território no MVP

Status: rejeitada para o MVP.

Motivo:

- Aumenta complexidade de regras, moderação, sincronização e anti-cheat.
- O MVP deve validar conquista individual primeiro.

## Template para nova decisão

```md
### Título da decisão

Status: proposta | aprovada | rejeitada | pendente.

Contexto:

- Descreva o problema.

Decisão:

- Descreva a decisão.

Motivo:

- Explique por que essa opção foi escolhida.

Impactos:

- GPS:
- Mapa:
- Firestore:
- Performance:
- Experiência do usuário:
```

## Documentos relacionados

- [[00-index]]
- [[02-mvp]]
- [[03-mecanica-territorios]]
- [[08-firebase-firestore]]
- [[09-arquitetura-tecnica]]


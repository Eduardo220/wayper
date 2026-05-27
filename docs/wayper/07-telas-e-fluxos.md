# Telas e fluxos

## Objetivo

As telas da Wayper devem apoiar o ciclo principal do MVP: entrar no app, permitir localização, iniciar atividade, acompanhar rota, encerrar, ver resumo e consultar progresso.

## Onboarding

Função:

- Explicar a proposta da Wayper.
- Preparar o usuário para conceder localização.
- Deixar claro que o app usa GPS real durante atividades.

Conteúdo mínimo:

- Corridas e caminhadas viram território.
- O mapa é o centro da experiência.
- Atividades válidas geram XP e progresso.

## Login e cadastro

Função:

- Criar conta.
- Entrar em conta existente.
- Associar atividades e progresso ao usuário.

Regras:

- Usuário precisa estar autenticado para salvar progresso.
- O app deve tratar erro de login de forma clara.
- Fluxo não deve bloquear entendimento inicial do produto mais do que o necessário.

## Mapa

Função:

- Ser a tela principal do app.
- Mostrar localização atual.
- Mostrar rota ou território quando disponível.
- Permitir iniciar caminhada ou corrida.

Elementos esperados:

- Mapa.
- Botão de iniciar atividade.
- Estado de GPS/permissão.
- Acesso a perfil e histórico.
- Indicação visual de território conquistado quando a regra estiver implementada.

## Atividade ativa

Função:

- Acompanhar caminhada ou corrida em tempo real.

Elementos esperados:

- Tempo ativo.
- Distância.
- Tipo da atividade.
- Estado do GPS.
- Botão de pausa.
- Botão de retomar.
- Botão de encerrar.
- Mapa com rota atual.

Cuidados:

- Botões devem ser grandes e fáceis de usar em movimento.
- A tela deve funcionar bem ao ar livre.
- O app deve indicar perda de sinal sem alarmismo.

## Resumo da atividade

Função:

- Mostrar resultado após encerramento.

Elementos esperados:

- Distância válida.
- Duração.
- Rota no mapa.
- XP ganho.
- Nível ou progresso de nível.
- Território conquistado.
- Alertas se parte da rota foi inválida.

## Perfil

Função:

- Mostrar progresso do usuário.

Elementos esperados:

- Nome ou identificação do usuário.
- XP total.
- Nível.
- Total de atividades.
- Distância total válida.
- Território conquistado, quando disponível.

## Histórico

Função:

- Listar atividades anteriores.

Elementos esperados:

- Data.
- Tipo de atividade.
- Distância.
- Duração.
- XP.
- Status de validação.
- Acesso ao detalhe da atividade.

## Ranking futuro

Ranking completo fica fora do MVP.

Quando implementado, deve permitir comparação por:

- XP.
- Distância.
- Território conquistado.
- Período.

Antes de ranking competitivo, revisar [[05-gps-e-validacao]] e [[06-xp-nivel-ranking]].

## Clans futuro

Clans ficam fora do MVP.

Quando implementados, devem permitir:

- Criar grupo.
- Entrar em grupo.
- Ver progresso coletivo.
- Participar de desafios.
- Competir por ranking de grupo.

Qualquer mecânica de clans deve ser registrada em [[12-ideias-futuras]] antes de virar escopo.

## Fluxo principal do MVP

1. Usuário abre o app.
2. Usuário faz login ou cadastro.
3. App solicita permissão de localização.
4. Usuário vê o mapa.
5. Usuário inicia caminhada ou corrida.
6. App registra rota com GPS.
7. Usuário pausa ou retoma se necessário.
8. Usuário encerra a atividade.
9. App calcula resumo, XP e território.
10. App salva dados no Firestore.
11. Usuário vê resumo e progresso.

## Documentos relacionados

- [[02-mvp]]
- [[04-regras-corrida]]
- [[05-gps-e-validacao]]
- [[09-arquitetura-tecnica]]


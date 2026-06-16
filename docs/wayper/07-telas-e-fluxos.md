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

## Home / Inicio

Funcao:

- Ser a tela inicial social do app.
- Mostrar atividade real de amigos, stories de corrida e feed, com dados locais/cacheados quando o remoto falhar.
- Manter a acao de corrida acessivel, mas sem transformar a Home em dashboard pessoal.
- Funcionar sem Firestore, usando dados locais/cacheados reais.

Elementos esperados:

- Header Wayper/Inicio com avatar e notificacoes.
- Stories horizontais com "Seu story"/Adicionar e stories locais/remotos reais.
- Amigos recentes ou ativos recentemente; indicador online somente quando houver presenca real.
- Feed de atividades reais com mapa/rota compacta, curtidas/comentarios quando disponiveis e estado vazio honesto.
- Acao compacta para iniciar corrida ou continuar/retomar corrida preservada.
- Acao "Adicionar ao story" listando corridas locais finalizadas elegiveis.
- Estados `remote`, `cache`, `local` e `empty` visiveis sem inventar usuarios, ranking ou atividade.
- Dashboard pessoal fica fora da Home, em Dashboard/Perfil.

Comportamento local-first:

- A tela deve consumir `socialHomeRepository`, nao Firestore direto.
- `socialHomeRepository` compoe `feedService`, `RunRepository`, `UserProfileRepository` e `activeRunTrackingService`.
- Corrida ativa vem de `wayper:activeRun:v2` por `activeRunTrackingService` e apenas navega para `Mapa`.
- O seletor de story usa corridas locais finalizadas do `RunRepository`; corrida ativa, pausada, recuperando ou `FINISHING` nao entra como story.
- Story criado localmente fica em `wayper_run_stories_v1` com status `PENDING_SYNC` ate existir envio remoto.
- Feed cacheado fica em `wayper_activity_feed_cache_v1` e pode alimentar a Home quando Firestore falhar.
- Demo/mock nao entra como amigo, story, online fake, ranking, progresso, avatar ou atividade real.
- Sem dados locais ou remotos, estados vazios devem ser claros e nao apagar a UI.

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

Complementos local-first:

- Corridas livres e corridas por zonas.
- Pace medio e melhores marcas quando houver dados confiaveis.
- Conquistas locais desbloqueadas e progresso parcial.
- Status local de sync/cache quando houver pendencias ou falhas.

Comportamento offline:

- A tela deve abrir com `UserProfileRepository`, sem depender obrigatoriamente de Firestore.
- Estatisticas locais devem vir de `profileStats`, usando `RunRepository`, `TerritoryRepository`, `ProgressionRepository` e `AchievementRepository`.
- Erro remoto nao deve apagar perfil local/cacheado.
- Avatar remoto ou upload por Storage sao melhor esforco; falha nao deve quebrar a tela nem apagar avatar local/cacheado.

## Ranking futuro

Ranking completo fica fora do MVP.

Quando implementado, deve permitir comparação por:

- XP.
- Distância.
- Território conquistado.
- Período.

Comportamento local-first atual:

- A tela deve consumir `RankingRepository`, nao Firestore direto.
- O repository deve identificar a origem com `source`: `remote`, `cache`, `local`, `empty` ou `demo`.
- Ranking cacheado/local/vazio precisa aparecer de forma honesta para o usuario.
- Ranking local pode mostrar apenas o usuario do aparelho quando houver dado real para o criterio; nao deve inventar oponentes.
- Demo/mock so pode aparecer identificado como `demo` e em fluxo dev/opt-in.

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

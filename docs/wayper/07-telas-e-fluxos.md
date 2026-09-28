# Telas e fluxos

## Objetivo

As telas da Wayper devem apoiar o ciclo: preparar, registrar atividade sem exigir
atenção, salvar com segurança e revelar resultados no pós-corrida.

## Onboarding

Função:

- Explicar a proposta da Wayper.
- Preparar o usuário para conceder localização.
- Deixar claro que o app usa GPS real durante atividades.

Conteúdo mínimo:

- Corridas e caminhadas viram território.
- O Relatório da Expedição é o centro da descoberta; mapa na corrida é opcional.
- Atividades válidas geram XP e progresso.
- Wayper funciona local/offline quando necessario e sincroniza depois.
- Localizacao foreground e necessaria para correr.
- Background location e notificacao ajudam durante corrida em andamento, mas devem ser explicadas antes de pedir.

Regras:

- Onboarding usa `wayper:onboarding:v1:completed`.
- Onboarding nao pede permissao nativa de localizacao, notificacao ou midia.
- Se houver corrida ativa preservada, a navegacao deve priorizar recuperacao da corrida em vez de prender o usuario no onboarding.

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

- Permitir exploração fora da corrida e, na implementação atual, iniciar atividade.
- Mostrar localização atual.
- Mostrar rota ou território quando disponível.
- Permitir iniciar caminhada ou corrida.

Elementos esperados:

- Mapa.
- Botão de iniciar atividade.
- Estado de GPS/permissão.
- Acesso a perfil e histórico.
- Indicação visual de território conquistado quando a regra estiver implementada.

Permissoes:

- Localizacao foreground negada bloqueia inicio/retomada de corrida.
- Background location negada deve mostrar aviso de corrida limitada, sem prometer tela bloqueada perfeita.
- Notificacao negada deve mostrar limitacao de controle externo, sem quebrar a corrida local-first.

## Atividade ativa

Função:

- Acompanhar caminhada ou corrida em tempo real.

Elementos esperados:

- Tempo ativo.
- Distância.
- Pace.
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

## Compartilhamento de corrida

Funcao:

- Permitir que o usuario compartilhe corrida finalizada de forma bonita e local-first.
- Separar imagem completa de tracado PNG transparente.
- Integrar story local da Home social sem depender de Firestore.

Elementos esperados:

- Modal `RunShareModal` com duas opcoes: `Imagem` e `Tracado PNG`.
- `Imagem`: preview com mapa/rota, identidade Wayper, distancia, tempo, pace, data, modo livre/zonas e area real quando existir.
- `Tracado PNG`: preview transparente apenas com rota ou poligono real de zona.
- Acoes dentro de cada opcao, sem botoes duplicados fora do bloco.
- Loading por acao e erro controlado para geracao, download, share nativo e story.

Comportamento local-first:

- Abrir modal nao pede permissao de midia.
- Baixar imagem/PNG pede permissao somente no clique de baixar.
- Compartilhar nativo usa arquivo temporario local.
- Story usa `wayper_run_stories_v1` com `PENDING_SYNC`.
- Corrida ativa, pausada, recuperando ou `FINISHING` nao pode virar story.
- Corrida livre nao mostra territorio falso.
- Corrida por zonas so desenha poligono quando `zoneCoords` existe; area pode aparecer quando ja foi salva como dado real.
- `Tracado PNG` usa `renderPath`/`segments` e nao conecta pausas/gaps.
- `Copiar` fica fora da UI enquanto nao houver suporte confiavel a clipboard de imagem.

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
3. Usuario novo ve onboarding local-first e conclui.
4. Usuario ve Inicio/Mapa.
5. Ao iniciar corrida, app explica e exige localizacao foreground.
6. App explica background/notificacao quando necessario e comunica limitacoes se negadas.
7. Usuario inicia caminhada ou corrida.
8. App registra rota com GPS e preserva `wayper:activeRun:v2`.
9. Usuario pausa ou retoma se necessario.
10. Usuario encerra a atividade.
11. App salva corrida localmente em `runs`, calcula resumo, XP e territorio quando aplicavel.
12. App enfileira sync posterior para Firestore.
13. Usuario ve resumo e progresso mesmo offline.

## Documentos relacionados

- [[02-mvp]]
- [[04-regras-corrida]]
- [[05-gps-e-validacao]]
- [[09-arquitetura-tecnica]]

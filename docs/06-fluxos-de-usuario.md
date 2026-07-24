# Fluxos de Usuário

Regra transversal: a atividade é um fluxo de registro seguro; o gameplay
principal começa depois do salvamento, no Relatório da Expedição.

## 0. Onboarding

1. Usuario novo autenticado abre o app sem corrida ativa preservada.
2. App mostra onboarding local-first (`wayper:onboarding:v1:completed`).
3. Onboarding explica corrida real, territorio, amigos/stories, uso offline, localizacao, background e notificacoes.
4. Onboarding nao pede permissao nativa de localizacao, notificacao ou midia.
5. Usuario conclui e entra na navegacao principal.
6. Ao reabrir, onboarding nao reaparece enquanto o marcador local existir.

## 1. Cadastro

1. Usuário abre o app.
2. Seleciona cadastro.
3. Informa dados necessários.
4. Firebase Auth cria a conta.
5. App cria documento em `users/{userId}`.
6. Usuário é enviado para tela principal.

## 2. Login

1. Usuário abre o app.
2. Informa credenciais.
3. Firebase Auth valida.
4. App tenta carregar perfil remoto/cache/local via `UserProfileRepository`.
5. Se Firestore falhar, app preserva perfil local/cacheado e estados honestos.
6. Usuário entra na tela principal.

## 3. Home / Inicio

1. Usuario entra no app e abre `Inicio`.
2. App monta a Home social por `socialHomeRepository`, sem Firestore obrigatorio.
3. App mostra stories de corrida reais/cacheados/locais, amigos recentes quando houver dado real/cacheado e feed social de atividades.
4. Se existir corrida `RUNNING` ou `PAUSED` preservada em `wayper:activeRun:v2`, a acao compacta leva ao `Mapa` para continuar; a Home nao pausa/finaliza/retoma diretamente.
5. Se nao existir corrida ativa, a acao compacta leva ao `Mapa` para iniciar uma corrida.
6. Usuario toca em `Seu story` ou `Adicionar ao story`.
7. App lista minhas corridas finalizadas vindas de `RunRepository`, excluindo ativa/`FINISHING`.
8. Usuario seleciona uma corrida e o app salva story local em `wayper_run_stories_v1` com `syncStatus=PENDING_SYNC`.
9. Se nao houver stories, amigos ou feed, a tela mostra estados vazios honestos sem inventar dados.
10. Estatisticas pessoais, XP, territorio, ranking e sync ficam em `Perfil`/`Dashboard`, nao como foco principal de `Inicio`.

## 4. Permissão de localização

1. Usuário acessa tela de corrida/mapa.
2. App pode checar status em foco, mas pedido nativo deve acontecer em acao explicita ou preflight de corrida.
3. Antes de iniciar/retomar corrida, app exige localizacao foreground.
4. Se permitir, app mostra posicao atual e libera corrida.
5. Se negar, app mostra aviso claro e bloqueia inicio da corrida.
6. Se `canAskAgain=false`, app mostra acao para abrir configuracoes.
7. Background location e explicada separadamente quando a corrida precisar funcionar com tela bloqueada/background.
8. Notificacao e explicada como apoio para corrida persistente; negar notificacao nao quebra a corrida.
9. Se qualquer permissao for revogada depois, app deve mostrar estado claro sem pedir em loop.

## 5. Iniciar corrida

1. Usuário toca em iniciar.
2. App valida localizacao foreground como permissao essencial.
3. App mostra feedback de inicio e evita duplo clique.
4. App explica/solicita background location e notificacao quando necessario, sem bloquear o app inteiro se forem negadas.
5. App comeca a coletar pontos GPS.
6. App mostra tempo, distância, pace, estado, GPS crítico e controles; mapa/rota é
   opcional.
7. App mantem estado de corrida ativa em `wayper:activeRun:v2`.
8. Território, parceiros, recompensas e promoções não exigem interação.

## 6. Finalizar corrida

1. Usuário toca em finalizar.
2. App marca fluxo de finalizacao e impede duplo encerramento.
3. App congela o snapshot canônico final e encerra a coleta com timeout controlado.
4. App consolida métricas mínimas de `trustedPath`, `renderPath` e `segments`.
5. App valida e persiste localmente o registro mínimo em `runs`.
6. App confirma que a corrida está finalizada antes de limpar a sessão ativa.
7. App devolve confirmação à interface.
8. App cria/atualiza tarefas persistentes de processamento da Expedição.
9. Território, XP, ranking, conquistas e sync executam depois e podem falhar
   independentemente.
10. App abre o resumo atual; futuramente ele será o Relatório da Expedição.
11. Se Firestore falhar, a corrida segue no histórico local e os estados pendentes
   permanecem recuperáveis.

## 6.1 Relatório da Expedição

1. Usuário chega ao relatório após a confirmação do save ou o reabre no histórico.
2. Métricas físicas disponíveis aparecem imediatamente.
3. Cada módulo carrega seu estado persistido: processando, pronto, falha
   recuperável, falha permanente ou não aplicável.
4. Território, progressão, ranking, desafio e recompensa atualizam sem bloquear os
   demais.
5. Usuário pode pular/fechar o relatório sem perder processamento ou resultado.
6. Replay, exportação e share usam apenas dados já disponíveis.
7. Reabrir o relatório mostra o mesmo estado e retoma trabalhos elegíveis.

## 7. Visualizar mapa

1. Usuário abre o mapa.
2. App carrega localização atual.
3. App carrega territorios locais atuais por `TerritoryRepository` quando o modo de zonas exigir.
4. App pode tentar remoto/cache como best effort, sem apagar local quando falhar.
5. App desenha áreas no mapa.
6. Usuário pode explorar regiões.
7. `zones` e `@wayper_zones` so entram por migracao/compatibilidade explicita.

## 8. Ranking

1. Usuário acessa ranking.
2. App usa `RankingRepository`.
3. App identifica origem: `remote`, `cache`, `local`, `empty` ou `demo`.
4. App destaca a posição/local do usuário quando houver dado real.
5. App permite alternar critérios: área, zonas, distância ou XP quando suportado.
6. Demo só aparece com opt-in/dev e nunca como fallback silencioso.

## 9. Perfil

1. Usuário abre perfil.
2. App usa `UserProfileRepository`.
3. App mostra dados básicos locais/cacheados/remotos quando existirem.
4. App mostra estatísticas reais por `profileStats`, incluindo runs locais pendentes/falhas.
5. App mostra XP/conquistas locais por repositories.
6. Usuário pode editar dados permitidos.
7. Upload remoto de avatar e best effort; falha nao apaga avatar local/cacheado.

## 10. Grupos/amigos

Fluxo ainda a validar.

Possível fluxo:

1. Usuário busca ou convida amigo.
2. Amigo aceita.
3. Usuário cria grupo ou entra em grupo.
4. Ranking do grupo é exibido.
5. Corridas e zonas podem alimentar ranking social.

## 11. Compartilhar corrida

1. Usuario abre o detalhe de uma corrida finalizada local ou o resumo da corrida salva.
2. Usuario toca em `Compartilhar corrida`.
3. App abre `RunShareModal` sem pedir permissao de midia.
4. Modal mostra duas opcoes:
   - `Imagem`: preview com mapa/rota, estatisticas, modo livre/zonas e area real quando existir.
   - `Tracado PNG`: preview transparente apenas com rota ou poligono real de zona.
5. Em `Imagem`, usuario pode compartilhar, baixar imagem ou adicionar ao story.
6. Em `Tracado PNG`, usuario pode compartilhar PNG, baixar PNG ou adicionar ao story quando houver pontos suficientes.
7. Compartilhar nativo gera arquivo temporario local e abre share sheet, sem Firestore.
8. Baixar imagem/PNG pede permissao de midia somente nesse momento; se falhar, mostra erro controlado e o usuario ainda pode compartilhar.
9. Adicionar ao story usa corrida finalizada local, cria item em `wayper_run_stories_v1` com `PENDING_SYNC` e atualiza cache/feed local da Home.
10. Tentar adicionar a mesma corrida de novo nao duplica story; o app informa que o story local ja existe.
11. Corrida ativa, pausada, recuperando ou `FINISHING` nao pode virar story.
12. Corrida livre nao mostra territorio falso; corrida por zonas so desenha poligono se `zoneCoords` existir.

## 12. Recovery de corrida

1. App abre ou volta do background.
2. `runRecoveryService` le `wayper:activeRun:v2`, checkpoint legado e evidencias recentes.
3. Corrida viva valida e hidratada/migrada para snapshot canonico antes de chegar na UI.
4. Corrida finalizada, pendente de sync ou `FINISHING` nao volta como ativa.
5. UI mostra estado recuperado ou erro recuperavel, sem inventar `IDLE` enquanto existir evidencia de corrida.

## 13. Diagnostico/export

1. Usuario abre `Configuracoes > Diagnostico`.
2. App carrega resumos pequenos por `localDiagnosticsService`.
3. Usuario pode exportar ZIP local com logs, snapshots leves e reports.
4. Coordenadas ficam mascaradas por padrao.
5. Export funciona offline e nao exige Firestore, Sentry ou upload.

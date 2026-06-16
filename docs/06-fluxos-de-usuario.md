# Fluxos de Usuário

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
4. App carrega perfil do Firestore.
5. Usuário entra na tela principal.

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
2. App solicita permissão de localização.
3. Se permitir, app mostra posição atual.
4. Se negar, app mostra aviso claro e bloqueia início da corrida.
5. Se a permissão for revogada depois, app deve tratar sem quebrar.

## 5. Iniciar corrida

1. Usuário toca em iniciar.
2. App valida localização disponível.
3. App começa a coletar pontos GPS.
4. App mostra tempo, distância e rota.
5. App mantém estado de corrida ativa.

## 6. Finalizar corrida

1. Usuário toca em finalizar.
2. App para coleta de localização.
3. App calcula métricas finais.
4. App valida corrida mínima.
5. App salva corrida.
6. App calcula zonas conquistadas.
7. App mostra resumo.

## 7. Visualizar mapa

1. Usuário abre o mapa.
2. App carrega localização atual.
3. App carrega zonas próprias.
4. App carrega zonas públicas/de outros usuários conforme regra.
5. App desenha áreas no mapa.
6. Usuário pode explorar regiões.

## 8. Ranking

1. Usuário acessa ranking.
2. App carrega lista global ou por período.
3. App destaca posição do usuário.
4. App permite alternar critérios: área, zonas, distância.

## 9. Perfil

1. Usuário abre perfil.
2. App mostra dados básicos.
3. App mostra estatísticas.
4. App mostra histórico/conquistas.
5. Usuário pode editar dados permitidos.

## 10. Grupos/amigos

Fluxo ainda a validar.

Possível fluxo:

1. Usuário busca ou convida amigo.
2. Amigo aceita.
3. Usuário cria grupo ou entra em grupo.
4. Ranking do grupo é exibido.
5. Corridas e zonas podem alimentar ranking social.

# Teste real de corrida em background

Este roteiro valida o fluxo critico de corrida ativa, snapshot local, background location e sync pendente.

## Checklist obrigatorio de hardening

1. Iniciar corrida, bloquear tela por alguns minutos e voltar pelo icone do app.
2. Iniciar corrida, bloquear tela e voltar pela notificacao persistente, quando existir.
3. Iniciar corrida, colocar app em background e voltar.
4. Iniciar corrida, pausar, matar app e reabrir.
5. Iniciar corrida em andamento, matar app e reabrir.
6. Finalizar corrida offline e confirmar que aparece localmente como pendente.
7. Voltar internet e confirmar sync sem duplicata.
8. Negar permissao de background e conferir mensagem clara.
9. Confirmar que os botoes de pausar, retomar e finalizar continuam clicaveis ao retornar.

O resultado esperado em todos os cenarios e preservar `localRunId`, status, tempo, distancia, path, rawPath, renderPath e segments. Corrida finalizada ou em `FINISHING` nao pode voltar como ativa.

## Preparacao

- Usar Android real com build dev e repetir em build release.
- Conceder localizacao em primeiro plano e em segundo plano.
- Manter GPS ligado e sair para area aberta.
- Confirmar que o Android mostra a notificacao persistente: "Wayper registrando corrida".
- Em aparelhos com economia agressiva de bateria, orientar o usuario a remover o Wayper da otimizacao de bateria.

## Cenario 1: tela bloqueada

1. Abrir Wayper.
2. Iniciar corrida livre.
3. Bloquear a tela e guardar o celular no bolso.
4. Correr ou caminhar por pelo menos 10 minutos.
5. Desbloquear e abrir o app.
6. Validar que a corrida continua ativa, com tempo/distancia coerentes e rota preservada.
7. Finalizar.
8. Validar que a corrida aparece no historico.

## Cenario critico: reentrada por icone e notificacao

1. Usar Android real em development build (`npm run dev:phone` ou APK dev). Nao validar este cenario no Expo Go.
2. Conceder localizacao em primeiro plano, localizacao em segundo plano e notificacoes.
3. Iniciar corrida livre.
4. Caminhar ou correr por 1 minuto com o app aberto.
5. Bloquear a tela por pelo menos 2 minutos.
6. Desbloquear e voltar pelo icone do app.
7. Confirmar que a tela volta para a corrida ativa sem modal bloqueando os controles.
8. Confirmar que tempo, distancia, rota e notificacao continuam coerentes.
9. Tocar em Pausar e confirmar que o botao responde.
10. Tocar em Retomar e confirmar que o GPS continua acumulando pontos na mesma corrida.
11. Bloquear a tela novamente por pelo menos 2 minutos.
12. Voltar tocando na notificacao permanente do Wayper.
13. Confirmar que o app foca a tela Mapa/corrida ativa sem empilhar outra tela.
14. Pausar, retomar e finalizar.
15. Salvar a corrida e confirmar que ela aparece no historico com a rota completa.
16. Repetir com economia de bateria ligada e desligada quando o aparelho permitir.

## Cenario 2: sem internet

1. Iniciar uma corrida.
2. Desligar Wi-Fi/dados moveis.
3. Bloquear a tela por alguns minutos.
4. Abrir o app e finalizar.
5. Confirmar que a corrida aparece localmente como pendente.
6. Religar internet.
7. Abrir o app e aguardar sync.
8. Confirmar que a mesma corrida foi enviada uma unica vez ao Firestore.

## Cenario 3: reinicio do app

1. Iniciar uma corrida.
2. Colocar o app em background.
3. Fechar o app pelo seletor de apps.
4. Abrir o Wayper novamente.
5. Validar a mensagem: "Corrida recuperada. Continuamos salvando seu trajeto."
6. Continuar, pausar, retomar e finalizar.

## Cenario 4: captura por zonas

1. Iniciar modo de zonas.
2. Fazer trajeto com loop valido.
3. Bloquear a tela durante parte do percurso.
4. Reabrir, finalizar e validar zona/historico.
5. Repetir com internet desligada e confirmar pendencia de sync.

## Limitacoes reais do Android

- Se o usuario usar "Forcar parada" nas configuracoes do Android, o sistema pode impedir qualquer task ate o app ser aberto manualmente.
- Fabricantes com economia agressiva podem encerrar processos mesmo com foreground service. O Wayper deve preservar o ultimo snapshot salvo, mas nao pode garantir pontos depois que o processo foi morto pelo sistema.
- Sem permissao de localizacao em segundo plano, o app bloqueia o inicio da corrida para evitar uma sessao quebrada.
- Testes em emulador nao validam completamente tela bloqueada, foreground service e restricoes agressivas de bateria; repetir em aparelho fisico antes de considerar o fluxo fechado.

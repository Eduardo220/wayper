# Teste real de corrida em background

Este roteiro valida o fluxo critico de corrida ativa, snapshot local, background location e sync pendente.

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

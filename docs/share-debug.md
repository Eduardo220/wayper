# Wayper Share Debug Checklist

Use este checklist quando alterar compartilhamento/exportacao de corridas.

- Android development build: finalizar uma corrida e testar `Imagem`, `Tracado PNG`, `Baixar mapa` e `Baixar PNG`.
- Android release APK: repetir o fluxo completo sem Metro aberto.
- iOS development build, se disponivel: repetir compartilhamento e salvamento.
- Corrida com menos de 2 pontos: deve mostrar mensagem de tracado indisponivel.
- Corrida curta com 2 pontos: deve gerar PNG de rota.
- Corrida por zonas com poligono: deve gerar arte preenchida.
- Sem permissao de galeria: deve pedir permissao e mostrar erro amigavel se negada.
- Com permissao de galeria: deve salvar no album `Wayper`.
- Compartilhar para WhatsApp, Instagram, Gmail/Drive e outros apps instalados.
- Clicar varias vezes rapido nos botoes: deve manter apenas uma acao ativa.
- Sem internet: card e PNG do tracado devem continuar funcionando, porque usam SVG/local cache.

Logs esperados em desenvolvimento:

- `[WayperShare] diagnostics`
- `[WayperShare:<context>]`

Se aparecer erro de modulo nativo como `Cannot find native module ExpoMediaLibrary`, gere e reinstale o dev build/APK depois de instalar `expo-media-library`.

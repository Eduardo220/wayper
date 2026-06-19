# Wayper Share Debug Checklist

Use este checklist quando alterar compartilhamento/exportacao de corridas.

- Android development build: finalizar uma corrida e testar `Imagem`, `Tracado PNG`, `Baixar mapa` e `Baixar PNG`.
- Android release APK: repetir o fluxo completo sem Metro aberto.
- iOS development build, se disponivel: repetir compartilhamento e salvamento.
- Corrida com menos de 2 pontos: deve mostrar mensagem de tracado indisponivel.
- Corrida curta com 2 pontos: deve gerar PNG de rota.
- Corrida por zonas com poligono: deve gerar arte preenchida.
- Corrida por zonas sem `zoneCoords`: nao deve inventar poligono; deve mostrar rota/metricas.
- Rota com pausa/gap: `Tracado PNG` deve respeitar segments e nao conectar trechos.
- Sem permissao de galeria: deve pedir permissao e mostrar erro amigavel se negada.
- Com permissao de galeria: deve salvar no album `Wayper`.
- Compartilhar para WhatsApp, Instagram, Gmail/Drive e outros apps instalados.
- Adicionar ao story: deve criar `wayper_run_stories_v1` com `PENDING_SYNC` e aparecer na Home social.
- Adicionar a mesma corrida ao story: nao deve duplicar.
- Copiar PNG: nao deve aparecer enquanto clipboard de imagem nao for suportado de forma confiavel.
- Clicar varias vezes rapido nos botoes: deve manter apenas uma acao ativa.
- Sem internet: card e PNG do tracado devem continuar funcionando, porque usam SVG/local cache.

Logs esperados no Diagnostico/export:

- categoria `SHARE`;
- evento `SHARE_CAPTURE_GENERATED` quando o PNG for criado;
- evento `SHARE_EXPORT_DIAGNOSTICS` quando o fluxo registrar a acao;
- evento `SHARE_<context>` em erro controlado;
- nenhum log deve incluir URI completa, token, email completo ou coordenadas brutas.

Se aparecer erro de modulo nativo como `Cannot find native module ExpoMediaLibrary`, gere e reinstale o dev build/APK depois de instalar `expo-media-library`.

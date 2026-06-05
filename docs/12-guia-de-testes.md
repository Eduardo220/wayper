# Guia de Testes

## Objetivo

Garantir que as partes críticas do Wayper funcionem antes de mexer em produção. Que conceito revolucionário: testar antes de quebrar.

## Comando base

```bash
npm test
```

## Testes unitários prioritários

### Corrida

- Cálculo de distância.
- Cálculo de duração.
- Cálculo de ritmo.
- Cálculo de velocidade.
- Validação de corrida mínima.
- Filtro de pontos GPS inválidos.

### Zonas

- Conversão de rota em área.
- Cálculo de área.
- Interseção/sobreposição.
- União de zonas.
- Validação de geometria.

### Ranking

- Ordenação por área.
- Ordenação por zonas.
- Ordenação por distância.
- Empate.
- Exclusão de corridas inválidas.

## Testes de integração

- Login com Firebase.
- Criação de documento de usuário.
- Salvamento de corrida.
- Leitura de histórico.
- Atualização de estatísticas.
- Carregamento de ranking.

## Testes manuais obrigatórios

### Emulador

- [ ] Abrir app.
- [ ] Login/cadastro.
- [ ] Permissão de localização.
- [ ] Mapa carregando.
- [ ] Iniciar corrida simulada.
- [ ] Finalizar corrida.
- [ ] Conferir histórico.

### Celular físico

- [ ] Instalar build dev.
- [ ] Testar localização real.
- [ ] Testar rota curta.
- [ ] Testar perda de internet.
- [ ] Testar app em segundo plano, se suportado.
- [ ] Testar finalização e persistência.

### Rua

- [ ] Iniciar corrida em ambiente real.
- [ ] Confirmar precisão do GPS.
- [ ] Confirmar desenho da rota.
- [ ] Finalizar corrida.
- [ ] Conferir zona/estatística gerada.

### GPS/path em rua

- [ ] Caminhar/correr em linha reta e comparar distancia aproximada.
- [ ] Fazer curva em esquina e validar que a linha nao corta quadra de forma agressiva.
- [ ] Dar volta em uma quadra e validar que o formato fecha de maneira plausivel.
- [ ] Parar por 30 a 60 segundos e confirmar que jitter parado nao infla distancia.
- [ ] Pausar, caminhar alguns metros, retomar e confirmar que o trecho pausado nao foi conectado.
- [ ] Bloquear tela durante parte do trajeto e validar que os pontos de background nao duplicam nem voltam no tempo.
- [ ] Passar por area com GPS ruim e confirmar que salto impossivel nao vira linha reta pela cidade.
- [ ] Finalizar offline e conferir que `rawPath`, `trustedPath`, `renderPath` e `segments` aparecem no historico local.
- [ ] Repetir em corrida livre e corrida por zonas.
- [ ] Abrir historico/replay/compartilhamento, se disponiveis, e conferir que pausas/gaps continuam separados.

## Cobertura automatizada de GPS/path

Os testes nao usam GPS real, MapLibre, Firebase real ou rede. Eles devem cobrir:

- Coordenadas invalidas, `0,0`, timestamp ausente, timestamp futuro, ponto antigo e ponto fora de ordem.
- Duplicatas foreground/background e lote de background recebido invertido.
- Accuracy ruim, velocidade impossivel, aceleracao alta, salto grande e jitter parado.
- Distancia apenas com `trustedPath`, sem somar durante `PAUSED` e sem conectar segmentos.
- Gap curto plausivel mantendo segmento; gap longo criando novo segmento.
- Preservacao de `rawPath`, `trustedPath`, `renderPath` e `segments` em save/recovery/sync.
- GeoJSON `LineString` para segmento unico e `MultiLineString` para multiplos segmentos.

## Casos ruins que precisam ser testados

- Usuário nega localização.
- GPS fica impreciso.
- Internet cai durante corrida.
- App fecha durante corrida.
- Usuário tenta finalizar corrida sem distância.
- Firestore falha.
- Ranking sem dados.
- Perfil sem foto/nome.

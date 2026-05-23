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

## Casos ruins que precisam ser testados

- Usuário nega localização.
- GPS fica impreciso.
- Internet cai durante corrida.
- App fecha durante corrida.
- Usuário tenta finalizar corrida sem distância.
- Firestore falha.
- Ranking sem dados.
- Perfil sem foto/nome.

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

## Historico e detalhes local-first

Checklist manual:

- [ ] Finalizar corrida online e abrir historico.
- [ ] Finalizar corrida offline e abrir historico sem religar internet.
- [ ] Abrir detalhes da corrida offline por item do historico.
- [ ] Voltar internet e confirmar que a corrida nao duplica apos sync.
- [ ] Simular sync falho e confirmar que a corrida segue visivel com status de falha.
- [ ] Abrir corrida livre e confirmar que nao aparece area falsa.
- [ ] Abrir corrida por zonas e confirmar area/territorio quando existirem.
- [ ] Conferir rota no detalhe usando pausas/gaps sem linha conectando trecho pausado.
- [ ] Matar app depois de finalizar e reabrir historico.
- [ ] Abrir detalhe por `localRunId` e por `remoteRunId`, quando disponiveis.

Cobertura automatizada esperada:

- Listagem local inclui `PENDING`, `FAILED`, `SYNCED` e `LOCAL_ONLY`.
- Listagem local ignora `RUNNING`, `PAUSED`, `RECOVERING` e `FINISHING`.
- Dedupe por `id`, `localRunId`, `remoteRunId`, `runId` e `legacyId`.
- Detalhe consegue buscar a corrida por qualquer id conhecido.
- `syncStatus`, `offlineStatus`, `remoteRunId`, path e `segments` sao preservados apos save/sync/retry.
- Firestore falhando nao apaga nem esconde a corrida local.

## Fila de sync local de corridas finalizadas

Checklist manual:

- [ ] Finalizar corrida online e confirmar que a corrida fica `SYNCED` com `remoteRunId`.
- [ ] Finalizar corrida offline e confirmar `PENDING_SYNC` no historico.
- [ ] Voltar internet e confirmar que a mesma corrida vira `SYNCED` sem duplicar.
- [ ] Simular Firestore falhando e confirmar `SYNC_FAILED` visivel no historico.
- [ ] Rodar retry e confirmar que usa o mesmo `remoteRunId`/`localRunId`.
- [ ] Abrir historico durante sync.
- [ ] Abrir detalhes durante sync.
- [ ] Matar app durante sync, reabrir e confirmar retomada da fila.
- [ ] Conferir que `trustedPath`, `renderPath`, `rawPath` e `segments` seguem no detalhe antes/depois do sync.
- [ ] Testar corrida livre e confirmar que o payload remoto nao inclui territorio falso.
- [ ] Testar corrida por zonas e confirmar `area`, `geometry`, `zoneCoords` e resumo territorial.
- [ ] Simular falha de territorio e confirmar que a corrida continua localmente visivel.

Cobertura automatizada esperada:

- Normalizacao de `PENDING_SYNC`, `SYNC_FAILED`, `LOCAL_ONLY` e status ausente.
- Offline nao chama Firestore.
- Retry nao cria documento diferente quando `remoteRunId` existe.
- Busca remota por `localRunId` antes de criar documento novo.
- Payload Firestore sem `undefined`, com `localRunId`, `remoteRunId`, modo, path e dados territoriais existentes.
- Corrida livre nao ganha `area`, `geometry` ou `zoneCoords` falsos no payload remoto.
- Lock impede dois syncs simultaneos.
- Sync antigo nao marca `SYNCED` se a copia local mudou durante o envio.
- Falha de Firestore preserva corrida local como `SYNC_FAILED`.

## Repositories local-first

Os testes de repositories nao usam Firebase real, rede real, GPS real nem MapLibre. Eles devem validar a arquitetura de acesso a dados sem recriar regras de dominio ja existentes em services oficiais.

Cobertura automatizada esperada:

- `RunRepository` lista pela fonte local oficial (`sync.loadLocalRunHistory()`), busca por `localRunId`/`remoteRunId`, salva sem perder `remoteRunId`, preserva `syncStatus`, path, `renderPath`, `trustedPath` e `segments`.
- `RunRepository` nao importa nem chama `runService.js` legado.
- `RunSyncQueueRepository` encapsula `runSyncQueueService`/`sync.js`, nao usa `wayper_unsynced_runs_v2` e nao cria fila paralela.
- `TerritoryRepository` le storage atual de territorios, preserva `geometry`, `zoneCoords` e `area`, trata storage vazio e separa `zones`/`@wayper_zones` como legado explicito.
- `UserProfileRepository` retorna cache/local quando Firestore falha, nao transforma erro remoto em quebra de tela e nao inventa mock como perfil real.
- `RankingRepository` diferencia `remote`, `cache`, `local`, `demo` e `empty`; Firestore falhando vira cache/estado vazio controlado.
- `storageMigrationService` roda uma vez, atualiza schemaVersion, marca storages legados e nao apaga dados.
- Telas adaptadas nao devem importar `firebase/firestore` diretamente quando houver repository/service correspondente.

Checklist manual adicional:

- [ ] Abrir o app com Firestore indisponivel e confirmar que home/perfil/ranking nao quebram.
- [ ] Abrir historico e detalhes offline.
- [ ] Confirmar que ranking sem dados reais mostra estado vazio/cache identificado, nao mock real.
- [ ] Confirmar que zonas legadas so aparecem onde o fluxo ainda chama leitura legada explicitamente.

## Territorios e zonas local-first

Checklist manual:

- [ ] Iniciar corrida por zonas online e finalizar com captura valida.
- [ ] Conferir no resumo `area`, `areaM2`, `zoneCoords`, `geometry`, `territorySummary` e eventos quando houver.
- [ ] Abrir historico e detalhe da corrida por zonas sem depender do Firestore.
- [ ] Iniciar corrida por zonas offline, finalizar e confirmar que territorio local fica salvo.
- [ ] Abrir mapa sem Firestore funcional e confirmar que territorios locais aparecem.
- [ ] Abrir dashboard/home sem Firestore e confirmar fallback local/cacheado ou vazio controlado.
- [ ] Abrir feed territorial/home sem internet e confirmar que nao aparece atividade demo como real.
- [ ] Abrir leaderboard territorial sem internet e confirmar cache/local/vazio controlado.
- [ ] Voltar internet e confirmar que corrida e territorio nao duplicam.
- [ ] Testar corrida livre e confirmar que nao aparece area, geometria, coords ou resumo territorial falso.
- [ ] Testar com storage legado `zones`/`@wayper_zones` e confirmar que so entra por migracao/compatibilidade explicita.

Cobertura automatizada esperada:

- `TerritoryRepository` lista/salva/atualiza territorios locais atuais e nao usa `zones` como storage novo.
- Normalizacao preserva `area`, `areaM2`, `geometry`, `zoneCoords`, `localId`, `remoteId`, `runLocalId`, `syncStatus` e `offlineStatus`.
- Eventos territoriais listam/salvam com identidade local e status de sync.
- Leaderboard cacheado lista/salva por `wayper_territory_leaderboards_v1`.
- Migracao de legado roda uma vez, nao apaga dados e nao duplica territories.
- Captura por zonas offline salva territorio/eventos locais e agenda sync futuro.
- Mesma corrida nao deve duplicar captura territorial.
- Corrida livre nao gera territorio e `saveLocalRun()` remove campos territoriais falsos localmente e no payload remoto.
- Corrida por zonas preserva resumo territorial e eventos no historico local.
- Feed/home usa territorios locais atuais quando Firestore falha e storage vazio retorna lista vazia controlada.

## XP, progresso e conquistas local-first

Checklist manual:

- [ ] Finalizar a primeira corrida livre valida e conferir XP, nivel e conquista "Primeira corrida".
- [ ] Finalizar segunda corrida e confirmar que XP soma sem duplicar a primeira.
- [ ] Matar o app e reabrir, confirmando que XP/progresso/conquistas foram preservados.
- [ ] Finalizar corrida offline e confirmar progresso local sem Firestore.
- [ ] Voltar internet e confirmar que sync de runs nao duplica XP.
- [ ] Finalizar corrida por zonas com captura valida e confirmar XP territorial.
- [ ] Finalizar corrida livre com payload sem territorio e confirmar que nao aparece XP territorial falso.
- [ ] Abrir perfil e dashboard com Firestore falhando e confirmar progresso local.
- [ ] Limpar storage em dev e confirmar estado inicial controlado.

Cobertura automatizada esperada:

- `ProgressionRepository` cria progresso inicial, calcula nivel, salva progresso e preserva `syncStatus`.
- Corrida finalizada valida gera eventos de XP locais com `localId`, `sourceRunId` e `type`.
- Corrida ativa, `FINISHING`, invalida ou curta nao gera XP.
- Mesma corrida/retry de sync nao duplica XP.
- Corrida livre nao recebe XP territorial.
- Corrida por zonas recebe XP territorial apenas com dados validos.
- Eventos corrompidos/storage vazio retornam estado controlado sem quebrar o app.
- `AchievementRepository` lista catalogo, salva progresso parcial, desbloqueia conquistas e nao duplica desbloqueios.
- Conquistas iniciais cobrem primeira corrida, distancia acumulada, primeira corrida por zonas, primeira area conquistada, 3 corridas e 30 minutos totais.
- Perfil/dashboard conseguem consumir progresso local sem Firebase real, rede real, GPS real ou MapLibre.

## Casos ruins que precisam ser testados

- Usuário nega localização.
- GPS fica impreciso.
- Internet cai durante corrida.
- App fecha durante corrida.
- Usuário tenta finalizar corrida sem distância.
- Firestore falha.
- Ranking sem dados.
- Perfil sem foto/nome.

# Ideias futuras

## Objetivo

Este arquivo guarda ideias fora do MVP ou fora da rodada atual. Uma ideia listada aqui nao esta automaticamente aprovada para implementacao. Para entrar no produto, precisa virar proposta em `../17-propostas-pendentes.md` e, se aprovada por Eduardo, ser registrada como decisao quando afetar produto, arquitetura, dados, Firestore, GPS, ranking ou fluxo.

## Modelo para registrar uma ideia futura

```md
### FUTURE-YYYYMMDD-001 - Titulo curto

- ID: FUTURE-YYYYMMDD-001
- Titulo:
- Visao:
- Por que isso pode melhorar o Wayper:
- Pre-requisitos:
- Impacto no produto:
- Risco:
- Dependencias:
- Quando considerar:
- Status: AGUARDANDO_VALIDAÇÃO_EDU | ADIADO | BLOQUEADO | REJEITADO
- Data: YYYY-MM-DD
```

## Futuro proximo

### FUTURE-20260620-001 - Feed social completo

- ID: FUTURE-20260620-001
- Titulo: Feed social completo
- Visao: evoluir a Home social para atividades recentes, curtidas, comentarios e compartilhamento de conquistas.
- Por que isso pode melhorar o Wayper: aumenta sensacao de comunidade e recorrencia sem tirar o foco de corrida real.
- Pre-requisitos: Home social local-first estabilizada, privacidade de rotas definida e Feed/Friends/Groups desacoplados de Firestore-first.
- Impacto no produto: mais engajamento e contexto social.
- Risco: moderacao, privacidade de localizacao e custo remoto.
- Dependencias: contrato remoto/cache social, regras de privacidade e validacao do Eduardo.
- Quando considerar: depois de validar corrida/share/Home social em aparelho real e definir politica de privacidade de rotas.
- Status: AGUARDANDO_VALIDAÇÃO_EDU
- Data: 2026-06-20

### FUTURE-20260620-002 - Conquistas expandidas

- ID: FUTURE-20260620-002
- Titulo: Conquistas expandidas
- Visao: ampliar medalhas/marcos alem do catalogo local inicial.
- Por que isso pode melhorar o Wayper: reforca progresso e recompensa exploracao real.
- Pre-requisitos: base local de XP/conquistas validada e regras de migracao estaveis.
- Impacto no produto: mais motivacao e leitura de progresso.
- Risco: excesso de notificacoes, regras dificeis de migrar e complexidade de balanceamento.
- Dependencias: `ProgressionRepository`, `AchievementRepository`, regra de notificacao e eventual sync remoto.
- Quando considerar: apos validar o catalogo inicial e a experiencia de Perfil/Dashboard.
- Status: AGUARDANDO_VALIDAÇÃO_EDU
- Data: 2026-06-20

### FUTURE-20260620-003 - Modo privado

- ID: FUTURE-20260620-003
- Titulo: Modo privado
- Visao: permitir atividade ou compartilhamento com menor exposicao social/geografica.
- Por que isso pode melhorar o Wayper: aumenta confianca para usuarios que correm perto de casa ou em horarios sensiveis.
- Pre-requisitos: politica de privacidade de rota e story definida.
- Impacto no produto: melhora seguranca percebida e aderencia a recursos sociais.
- Risco: complexidade de estados de visibilidade e sync.
- Dependencias: Home social, stories, feed e regras remotas futuras.
- Quando considerar: antes de ampliar feed social publico ou compartilhamento remoto.
- Status: AGUARDANDO_VALIDAÇÃO_EDU
- Data: 2026-06-20

## Futuro medio prazo

### FUTURE-20260620-004 - Ranking global

- ID: FUTURE-20260620-004
- Titulo: Ranking global
- Visao: ranking entre usuarios por XP total, distancia mensal, territorio conquistado ou atividades concluidas.
- Por que isso pode melhorar o Wayper: cria comparacao social e meta recorrente.
- Pre-requisitos: antifraude mais robusto, contrato remoto de agregados e politica de privacidade.
- Impacto no produto: competicao e retencao.
- Risco: GPS falso, custo de atualizacao e desmotivacao de iniciantes.
- Dependencias: sync remoto, ranking cacheado, regras de seguranca e validacao real de GPS.
- Quando considerar: depois de ranking local/cache estar validado e Eduardo aprovar competicao mais forte.
- Status: AGUARDANDO_VALIDAÇÃO_EDU
- Data: 2026-06-20

### FUTURE-20260620-005 - Eventos por periodo

- ID: FUTURE-20260620-005
- Titulo: Eventos por periodo
- Visao: objetivos temporarios, como conquistar zonas em uma semana, caminhar certa distancia no fim de semana ou explorar bairros especificos.
- Por que isso pode melhorar o Wayper: cria campanhas e momentos de retorno ao app.
- Pre-requisitos: regras temporais, comunicacao clara e diagnostico de resultados.
- Impacto no produto: aumenta recorrencia e variedade.
- Risco: regras confusas, custo remoto e necessidade de ranking por periodo.
- Dependencias: backend/sync, notificacoes e validacao antifraude.
- Quando considerar: apos validar corrida, XP, territorios e feed social basico.
- Status: AGUARDANDO_VALIDAÇÃO_EDU
- Data: 2026-06-20

### FUTURE-20260620-006 - Desafios semanais

- ID: FUTURE-20260620-006
- Titulo: Desafios semanais
- Visao: objetivos recorrentes como completar 3 atividades, caminhar 5 km, explorar 3 novas zonas ou bater XP semanal.
- Por que isso pode melhorar o Wayper: oferece metas curtas e recorrentes.
- Pre-requisitos: regras de progresso, balanceamento e comunicacao de resultado.
- Impacto no produto: retencao semanal.
- Risco: notificacoes excessivas, fraude em ranking e metas mal calibradas.
- Dependencias: XP local/remoto, territorios, notificacoes e possivel backend.
- Quando considerar: depois de validar progresso local e definir se desafios entram no MVP expandido.
- Status: AGUARDANDO_VALIDAÇÃO_EDU
- Data: 2026-06-20

## Futuro longo prazo

### FUTURE-20260620-007 - Clans

- ID: FUTURE-20260620-007
- Titulo: Clans
- Visao: grupos de usuarios que somam progresso, entram por convite e competem por ranking/progresso territorial coletivo.
- Por que isso pode melhorar o Wayper: aumenta colaboracao e identidade de grupo.
- Pre-requisitos: social remoto, convites, moderacao, agregados e regras antifraude.
- Impacto no produto: comunidade e competicao coletiva.
- Risco: moderacao, abuso de convites, agregados complexos e fraude afetando grupos.
- Dependencias: backend, Feed/Friends/Groups local-first, ranking remoto e decisoes de produto.
- Quando considerar: fora do MVP; apenas apos Eduardo aprovar a estrategia social/grupos.
- Status: ADIADO
- Data: 2026-06-20

### FUTURE-20260620-008 - Disputa por territorio

- ID: FUTURE-20260620-008
- Titulo: Disputa por territorio
- Visao: usuarios ou clans disputam posse de areas por maior atividade recente, XP territorial ou presenca acumulada.
- Por que isso pode melhorar o Wayper: torna o mapa mais competitivo e vivo.
- Pre-requisitos: regra final de territorio, antifraude forte, sync remoto e moderacao.
- Impacto no produto: competicao territorial.
- Risco: complexidade alta, conflito entre usuarios, regras de perda e custo.
- Dependencias: decisoes pendentes de territorio, backend e validacao real de GPS.
- Quando considerar: depois de validar progresso territorial individual e ranking social.
- Status: ADIADO
- Data: 2026-06-20

### FUTURE-20260620-009 - Zonas temporarias

- ID: FUTURE-20260620-009
- Titulo: Zonas temporarias
- Visao: areas especiais no mapa por tempo limitado, como bonus, eventos ou zonas patrocinadas futuras.
- Por que isso pode melhorar o Wayper: cria novidades no mapa e incentiva exploracao.
- Pre-requisitos: geofencing, renderizacao eficiente e regras temporais.
- Impacto no produto: exploracao orientada por eventos.
- Risco: comunicacao visual confusa, custo de atualizacao e complexidade de mapa.
- Dependencias: backend, cache local, MapLibre e validacao de UX.
- Quando considerar: depois de eventos/desafios e territorio individual estarem estaveis.
- Status: ADIADO
- Data: 2026-06-20

### FUTURE-20260620-010 - Skins e personalizacao visual

- ID: FUTURE-20260620-010
- Titulo: Skins e personalizacao visual
- Visao: personalizar marcadores de mapa, estilo de rota, moldura de perfil ou tema de territorio.
- Por que isso pode melhorar o Wayper: adiciona expressao pessoal e recompensa visual.
- Pre-requisitos: produto principal validado e regras de inventario simples.
- Impacto no produto: acabamento, identidade e monetizacao futura possivel.
- Risco: virar distracao antes do core estar validado.
- Dependencias: design system, inventario futuro e validacao do Eduardo.
- Quando considerar: depois de corrida, social e progresso estarem estaveis.
- Status: ADIADO
- Data: 2026-06-20

## Ideias dependentes de backend/sync remoto

- Ranking global.
- Eventos por periodo.
- Desafios semanais com comparacao social.
- Clans.
- Disputa por territorio.
- Zonas temporarias.
- Feed social completo com curtidas/comentarios.
- Integracao com wearables.
- Rotas recomendadas.
- Temporadas e ligas por nivel.

Nenhuma dessas ideias deve ser documentada como implementada enquanto existir apenas base local, cache ou status `PENDING_SYNC`.

## Ideias dependentes de validacao real

- Background/tela bloqueada em aparelhos Android reais.
- GPS em rua com trajetos longos, curvas, pausas, perda de sinal e economia de bateria.
- Compartilhamento de imagem/trace PNG em apps reais.
- Privacidade de rotas antes de feed social publico.
- Performance de historico/rotas longas antes de SQLite.
- Heatmap pessoal com volume real de dados.
- Estatisticas por bairro com geocodificacao/regioes reais.

## Ideias descartadas por enquanto

Nenhuma ideia descartada definitivamente neste arquivo. Clans, disputa por territorio, zonas temporarias e skins estao `ADIADO`, nao `REJEITADO`.

## Outras ideias para avaliar depois

- Integracao com wearables.
- Rotas recomendadas.
- Compartilhamento de resumo expandido.
- Estatisticas por bairro.
- Heatmap pessoal.
- Temporadas.
- Ligas por nivel.

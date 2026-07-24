# Ideias de Melhoria

Este arquivo guarda ideias sugeridas por Eduardo, por conversas de produto ou pela IA. Ideia aqui nao e decisao oficial, nao e tarefa aprovada e nao pode ser implementada automaticamente.

## Convencao de status

- `AGUARDANDO_VALIDAÇÃO_EDU`: sugestao registrada; Eduardo ainda nao decidiu.
- `APROVADO`: Eduardo aprovou a ideia como direcao ou proposta futura.
- `EM_IMPLEMENTAÇÃO`: existe pedido explicito para implementar.
- `IMPLEMENTADO`: ja foi entregue e documentado.
- `EM_VALIDAÇÃO`: entregue ou prototipada, mas ainda precisa validacao.
- `REJEITADO`: descartada com motivo.
- `ADIADO`: valida, mas fora da rodada atual.
- `BLOQUEADO`: depende de decisao, aparelho, backend, credencial, dados reais ou outra etapa.

Quando for necessario manter ASCII, `AGUARDANDO_VALIDACAO_EDU` e equivalente operacional de `AGUARDANDO_VALIDAÇÃO_EDU`.

## Modelo para registrar uma ideia

```md
### IDEA-YYYYMMDD-001 - Titulo curto

- ID: IDEA-YYYYMMDD-001
- Titulo:
- Origem: Eduardo | Codex | bug | revisao | teste real | suporte | outro
- Relacionada a qual alteracao:
- Arquivos afetados ou provaveis:
- Problema/oportunidade:
- Proposta:
- Impacto esperado:
- Complexidade: baixa | media | alta
- Risco:
- Dependencias:
- Status: AGUARDANDO_VALIDAÇÃO_EDU
- Proximo passo sugerido:
- Prompt futuro sugerido:
- Data: YYYY-MM-DD
```

## Ideias aguardando avaliacao do Eduardo

### IDEA-20260527-001 - Suavizacao da linha da corrida

- ID: IDEA-20260527-001
- Titulo: Suavizacao da linha da corrida
- Origem: IA
- Relacionada a qual alteracao: planejamento inicial de GPS/mapa
- Arquivos afetados ou provaveis: `docs/wayper/05-gps-e-validacao.md`, `docs/wayper/03-mecanica-territorios.md`, `docs/04-arquitetura.md`, `docs/10-regras-de-negocio.md`
- Problema/oportunidade: rota visual tremida reduz confianca no mapa mesmo quando a atividade e valida.
- Proposta: aplicar suavizacao/simplificacao conservadora apenas na rota visual, preservando pontos brutos ou validados para auditoria.
- Impacto esperado: melhorar leitura do mapa e confianca sem alterar distancia, XP ou territorio.
- Complexidade: media
- Risco: suavizar demais, cortar caminho, esconder problemas reais de GPS ou divergir do territorio calculado.
- Dependencias: diferenca clara entre `rawPath`, `trustedPath`, `renderPath` e `segments`.
- Status: AGUARDANDO_VALIDAÇÃO_EDU
- Proximo passo sugerido: converter em proposta se Eduardo quiser revisar a qualidade visual de rota.
- Prompt futuro sugerido: "Criar proposta para suavizacao visual conservadora da rota, preservando metricas e diagnostico."
- Data: 2026-05-27

### IDEA-20260527-002 - Desafios semanais por bairro

- ID: IDEA-20260527-002
- Titulo: Desafios semanais por bairro
- Origem: IA
- Relacionada a qual alteracao: planejamento de gamificacao
- Arquivos afetados ou provaveis: `docs/02-roadmap.md`, `docs/03-backlog.md`, `docs/wayper/02-mvp.md`, `docs/wayper/06-xp-nivel-ranking.md`
- Problema/oportunidade: aumentar recorrencia e exploracao urbana com objetivos claros.
- Proposta: criar desafios por bairro, como completar atividades em uma regiao ou explorar trechos novos.
- Impacto esperado: aumentar retencao e descoberta territorial.
- Complexidade: alta
- Risco: ficar fora do MVP, aumentar custo remoto, exigir dados geograficos ainda nao definidos e incentivar competicao antes de antifraude.
- Dependencias: GPS confiavel, regras de territorio, modelo remoto e validacao de produto.
- Status: AGUARDANDO_VALIDAÇÃO_EDU
- Proximo passo sugerido: manter como ideia ate corrida, historico, zonas e GPS estarem validados.
- Prompt futuro sugerido: "Avaliar desafios semanais por bairro como proposta fora do MVP, com riscos de GPS, custo e antifraude."
- Data: 2026-05-27

### IDEA-20260527-003 - Alerta visual para GPS fraco

- ID: IDEA-20260527-003
- Titulo: Alerta visual para GPS fraco
- Origem: IA
- Relacionada a qual alteracao: planejamento de GPS/UX
- Arquivos afetados ou provaveis: `docs/wayper/05-gps-e-validacao.md`, `docs/wayper/04-regras-corrida.md`, `docs/06-fluxos-de-usuario.md`, `docs/10-regras-de-negocio.md`
- Problema/oportunidade: usuario precisa saber durante a atividade quando a qualidade do GPS pode afetar distancia, XP ou territorio.
- Proposta: mostrar indicador visual simples durante atividade ativa quando a precisao estiver ruim ou instavel.
- Impacto esperado: aumentar transparencia e reduzir frustracao ao final da corrida.
- Complexidade: media
- Risco: alertas excessivos irritarem, mensagem pouco clara ou aviso sem impacto real.
- Dependencias: estado de qualidade do GPS exposto pelo pipeline oficial.
- Status: AGUARDANDO_VALIDAÇÃO_EDU
- Proximo passo sugerido: converter em proposta quando o fluxo de atividade ativa for revisado.
- Prompt futuro sugerido: "Criar proposta de alerta de GPS fraco usando pipeline oficial, sem recalcular rota."
- Data: 2026-05-27

## Ideias priorizadas

Nenhuma ideia priorizada nesta rodada. Itens so entram aqui apos validacao explicita do Eduardo.

## Ideias rejeitadas

Nenhuma ideia rejeitada registrada neste arquivo no momento.

## Ideias implementadas

- `IDEA-20260621-002`: fila persistente pós-finalização implementada no caminho
  `runDeferredTaskQueueService` e registrada como base do futuro pipeline da
  Expedição. A validação física e a materialização completa de ranking/feed ainda
  estão pendentes.

## Ideias geradas automaticamente apos alteracoes

### IDEA-20260620-001 - Validador de consistencia docs-codigo por rodada

- ID: IDEA-20260620-001
- Titulo: Validador de consistencia docs-codigo por rodada
- Origem: Codex
- Relacionada a qual alteracao: criacao do protocolo "Obsidian como mente do projeto"
- Arquivos afetados ou provaveis: `docs/14-instrucoes-para-ia.md`, `docs/00-fontes-do-projeto.md`, `docs/13-bugs-conhecidos.md`, `docs/16-ideias-de-melhoria.md`, `docs/17-propostas-pendentes.md`, `docs/wayper/12-ideias-futuras.md`, `docs/24-resumo-rodada-local-first.md`, scripts futuros opcionais em `scripts/`
- Problema/oportunidade: o protocolo depende de disciplina humana/IA; um check leve poderia apontar quando uma rodada altera codigo sem docs relacionados, mexe em `.obsidian` local ou deixa ideia/proposta sem status.
- Proposta: criar futuramente um script opcional de validacao documental que leia `git diff --name-only`, detecte dominios alterados e sugira docs esperados, sem bloquear automaticamente nem aprovar ideias.
- Impacto esperado: reduzir esquecimento de docs, melhorar rastreabilidade e manter Eduardo como aprovador das proximas tarefas.
- Complexidade: media
- Risco: gerar falso positivo, virar burocracia ou parecer aprovacao automatica se o texto nao for cuidadoso.
- Dependencias: protocolo atual estabilizado, exemplos reais de rodadas e decisao do Eduardo sobre nivel de automacao.
- Status: AGUARDANDO_VALIDAÇÃO_EDU
- Proximo passo sugerido: Eduardo decidir se quer transformar a ideia em proposta pendente para um script `docs:check` ou manter apenas como pratica manual.
- Prompt futuro sugerido: "Avaliar e, se aprovado, criar proposta para um validador leve de consistencia entre alteracoes de codigo e Markdown do Wayper, sem aprovar ideias automaticamente."
- Data: 2026-06-20

### IDEA-20260621-001 - Painel local de correlacao Sentry e diagnostico

- ID: IDEA-20260621-001
- Titulo: Painel local de correlacao Sentry e diagnostico
- Origem: Codex
- Relacionada a qual alteracao: hardening de Sentry/observabilidade para freeze de corrida ativa
- Arquivos afetados ou provaveis: `src/screens/DiagnosticsScreen.js`, `src/services/diagnostics/localDiagnosticsService.js`, `src/services/diagnostics/diagnosticExportService.js`, `src/services/monitoring/sentryService.js`, `docs/12-guia-de-testes.md`
- Problema/oportunidade: o ZIP local passa a carregar `sentryEventId` quando ha envio remoto, mas a tela de Diagnostico ainda pode nao destacar claramente os ultimos IDs/eventos Sentry relacionados a uma corrida ativa.
- Proposta: criar futuramente uma secao "Correlacao Sentry" na tela/ZIP de Diagnostico mostrando ultimos `sentryEventId`, eventos criticos, runId anonimizado, ambiente, release/dist e instrucoes curtas para comparar com o painel Sentry.
- Impacto esperado: reduzir tempo de investigacao quando usuario envia ZIP local e a equipe tambem tem evento Sentry.
- Complexidade: media
- Risco: confundir usuario final ou expor identificadores demais se a UI nao for bem resumida.
- Dependencias: validacao real de eventos Sentry em preview/producao e decisao do Eduardo sobre mostrar essa secao na UI ou apenas no ZIP.
- Status: AGUARDANDO_VALIDACAO_EDU
- Proximo passo sugerido: Eduardo decidir se quer transformar em proposta depois da primeira rodada de eventos reais do bug de freeze.
- Prompt futuro sugerido: "Criar proposta para uma secao de correlacao Sentry no Diagnostico local do Wayper, sem expor PII e sem substituir o ZIP."
- Data: 2026-06-21

### IDEA-20260621-002 - Fila persistente para tarefas pos-finalizacao — implementada

- ID: IDEA-20260621-002
- Titulo: Fila persistente para tarefas pos-finalizacao
- Origem: Codex
- Relacionada a qual alteracao: finalizacao local-first nao bloqueada por captura territorial, XP e sync
- Arquivos afetados: `src/services/run/runDeferredTaskQueueService.js`, `src/repositories/runDeferredTaskQueueRepository.js`, `src/screens/MapScreen.js`, `src/navigation/MainNavigator.js`, `src/services/run/__tests__/runDeferredTaskQueueService.test.js`
- Problema/oportunidade: a corrida salva localmente antes das tarefas pesadas e precisa reprocessar captura territorial e progressao depois de app kill, timeout ou falta de memoria, sem depender da tela aberta.
- Implementação: fila local por corrida/tipo com estados persistentes, tentativas, prioridade e processamento na reabertura/AppState. Território, XP e sync usam os repositories existentes.
- Impacto esperado: tornar captura territorial, XP e sync ainda mais recuperaveis sem recolocar esses trabalhos no caminho critico do botao `Finalizar`.
- Complexidade: media
- Risco restante: ranking/feed ainda não materializam resultado específico da
  Expedição; falta contrato por módulo e validação física após kill/reabertura.
- Dependencias: evolução incremental para o pipeline da Expedição e matriz Android.
- Status: IMPLEMENTADO
- Próximo passo sugerido: evoluir a fila existente; não criar uma segunda fila.
- Evidência: branch `develop` auditada em 2026-07-24 e ADR-031.
- Data: 2026-06-21

### IDEA-20260721-001 - Telemetria local de custo e janela adaptativa de checkpoint

- ID: IDEA-20260721-001
- Titulo: Telemetria local de custo e janela adaptativa de checkpoint
- Origem: Codex
- Relacionada a qual alteracao: task headless, checkpoint canonico em lote e reducao de renderizacao da corrida ativa
- Arquivos afetados ou provaveis: `src/services/runTracking/activeRunTrackingService.js`, `src/services/diagnostics/localDiagnosticsService.js`, `src/screens/DiagnosticsScreen.js`, `docs/12-guia-de-testes.md`
- Problema/oportunidade: a janela fixa de aproximadamente 5 segundos limita writes sem gravar por ponto, mas aparelhos, duracao de corrida e tamanho de chunks variam. Ainda falta evidencia real de latencia, bytes, falhas e consumo para saber se o intervalo ideal deve mudar ou se AsyncStorage deve migrar.
- Proposta: medir localmente, de forma agregada e sem coordenadas, duracao/bytes de checkpoint, pontos pendentes, maior janela sem flush, falhas e memoria aproximada. Depois de validacao, avaliar uma politica adaptativa limitada (por exemplo 3-10 segundos) ou SQLite, sem alterar a interface canonica.
- Impacto esperado: equilibrar perda maxima em kill, I/O, bateria e desempenho de corridas longas com decisao baseada em dados reais.
- Complexidade: media
- Risco: tornar o checkpoint complexo, aumentar logs ou ajustar agressivamente sem amostra representativa.
- Dependencias: testes fisicos dev/release, corridas longas e aprovacao do Eduardo antes de mudar intervalo/storage.
- Status: AGUARDANDO_VALIDACAO_EDU
- Proximo passo sugerido: coletar primeiro metricas agregadas na matriz Android real e decidir se a ideia vira proposta.
- Prompt futuro sugerido: "Criar proposta de telemetria local e politica adaptativa de checkpoint da corrida ativa, sem coordenadas e sem migrar storage antes de medir."
- Data: 2026-07-21

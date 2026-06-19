# Instruções para IA no Projeto Wayper

Use este arquivo como fonte para configurar o Project/GPT do Wayper.

## Contexto

O Wayper é um app mobile de corrida gamificado. Usuários registram rotas reais, conquistam zonas no mapa, competem em rankings e acompanham evolução.

## Branches

- `develop`: desenvolvimento ativo.
- `main`: versão oficial/estável.

## Prioridade de fontes

1. Código atual do repositório na branch `develop`.
2. Código estável da branch `main`, quando a pergunta for sobre produção.
3. `README.md`.
4. Arquivos em `/docs`.
5. Issues e PRs.
6. Conhecimento geral, apenas quando faltar informação no projeto.

## Regras de resposta

Quando responder sobre o Wayper:

- Comece analisando a branch `develop`, `git status`, codigo existente e docs relevantes.
- Consulte o contexto do repositório antes de sugerir mudanças.
- Não invente estrutura se o código mostrar outra.
- Aponte arquivos prováveis de alteração.
- Separe solução rápida de solução bem feita.
- Quando algo não estiver definido, marque como suposição.
- Priorize segurança, privacidade e consistência dos dados.
- Não sugira expor credenciais, tokens ou arquivos `.env`.
- Não trate documentação antiga como verdade se ela contradiz o código.
- Use `docs/24-resumo-rodada-local-first.md` como resumo rapido do estado consolidado em 2026-06-19.

## Regras técnicas

- Respeitar React Native/Expo.
- Respeitar Firebase Auth e Firestore.
- Tratar Firestore como remoto/best effort nos fluxos local-first consolidados; nao afirmar que foi removido.
- Respeitar MapLibre/OpenFreeMap.
- Usar Turf para geometrias quando fizer sentido.
- Testar regras críticas de corrida, zona e ranking.
- Cuidar de permissão de localização e falhas de GPS.
- Preservar a arquitetura local-first atual: corrida ativa em `wayper:activeRun:v2`, historico em `runs` via `sync.js`, sync de runs por `runSyncQueueService`.
- Preferir repositories/facades existentes antes de chamar Firestore em telas.
- Nao reativar `runService.js` legado nem `wayper_unsynced_runs_v2` como base nova.
- Para territorios, usar `TerritoryRepository`/`territoryStorageService` e os storages atuais `wayper_territories_v1`, `wayper_territory_events_v1` e `wayper_territory_leaderboards_v1`.
- Nao gravar novo dado territorial em `zones` ou `@wayper_zones`; esses storages sao legado/migracao explicita.
- Corrida livre nao pode ganhar `area`, `geometry`, `zoneCoords`, `territorySummary` ou eventos territoriais falsos.
- Corrida por zonas deve preservar `area`, `areaM2`, `geometry`, `zoneCoords`, `territorySummary`, `territoryEvents` e `capturedCells` quando a captura local existir.
- Para XP/progresso/conquistas, usar `ProgressionRepository` e `AchievementRepository` com os storages `wayper_user_progress_v1`, `wayper_xp_events_v1`, `wayper_achievements_v1` e `wayper_achievement_progress_v1`.
- Nao usar `xpService`, `MedalsWidget`, `medals` ou `@wayper:medals_awarded_v1` como fonte de progresso real sem migracao explicita.
- XP so deve ser aplicado apos corrida finalizada salva localmente; corrida ativa ou `FINISHING` nao gera XP.
- Para `Inicio`/Home principal, usar `socialHomeRepository` como composicao social local-first; nao chamar Firestore direto na tela.
- Home deve mostrar stories, amigos recentes/presenca real-cacheada e feed de atividades; nao deve virar dashboard pessoal.
- Dashboard pessoal deve ficar em `Dashboard`, `Perfil` ou resumo dedicado, podendo reaproveitar `homeDashboardRepository`/`profileStats`.
- Home nao deve mostrar demo/mock como story, amigo, online, feed, ranking real, progresso real, avatar real ou territorio real.
- Home nao deve pausar/finalizar/retomar corrida diretamente; deve navegar para `Mapa` quando houver corrida ativa/pausada preservada.
- Home nao deve renderizar mapa/rota pesada nem carregar `rawPath` para preview; detalhes ficam para Historico/Detalhe/Mapa.
- "Adicionar ao story" deve usar `RunRepository`, salvar em `wayper_run_stories_v1` como `PENDING_SYNC`, excluir corrida ativa/`FINISHING` e nao fingir publicacao remota.
- Feed social cacheado deve usar origem explicita (`remote`, `cache`, `local`, `empty`) e nunca cair em demo silencioso.
- Para diagnostico/debug, usar `src/screens/DiagnosticsScreen.js`, `localDiagnosticsService`, `runDiagnosticsService`, `diagnosticExportService`, `logStorageService` e `logger.js`; nao criar logger, export ZIP, service de storage ou tela debug paralelos.
- Diagnostico local deve funcionar offline e sem Firestore obrigatorio.
- Logs novos devem passar pelo logger central, com categoria adequada e contexto sanitizado.
- Coordenadas exatas, `rawPath` completo, tokens, emails completos, imagens privadas e payload completo de terceiros nao devem entrar em export/resumo padrao.
- Debug de alta frequencia deve usar buffer/file-system existente; nao gravar ponto GPS por evento no AsyncStorage.
- Acoes destrutivas em debug exigem confirmacao explicita e nao devem limpar corridas/runs por padrao.
- Para permissoes, usar `src/services/permissions.js`; nao criar facade paralela.
- Onboarding deve informar sem pedir permissao nativa cedo demais.
- Foreground location e obrigatoria para iniciar/retomar corrida; background location e notificacoes sao limitacoes comunicadas quando negadas.
- Nao pedir permissao em loop no mount/focus; pedidos nativos devem vir de acao explicita ou preflight contextual.
- Estados vazios/erro/offline/permissao devem reutilizar `src/components/states` quando possivel.
- Usuario offline ou sem Firestore deve ver local/cache/vazio honesto, sem spinner infinito e sem mock como dado real.
- Nao adicionar SQLite sem ADR, medicao e plano incremental.
- Nao afirmar que background/tela bloqueada esta 100% validado sem teste fisico Android dev/release.
- Nao afirmar que stories, XP/conquistas ou territorio ja possuem sync remoto completo enquanto os contratos forem futuros.
- Nao alterar ou commitar `docs/.obsidian/workspace.json`, `docs/.obsidian/graph.json` ou arquivos com apenas ruído de line-ending.

## Prompt base obrigatorio para IA/Codex

```txt
Antes de implementar qualquer coisa:
1. Analise o codigo atual da branch develop.
2. Verifique se ja existe algo parecido implementado.
3. Leia os arquivos relevantes em /docs.
4. Nao duplique services, hooks, repositories, componentes ou logica existente.
5. Se algo ja existir parcialmente, refatore e complete em vez de criar implementacao paralela.
6. Preserve padrao visual, arquitetura, nomenclatura e estrutura atual.
7. Nao remova funcionalidades existentes sem justificar.
8. Nao dependa obrigatoriamente de Firestore nos fluxos local-first.
9. Atualize docs/ADRs quando criar ou consolidar decisao tecnica importante.
10. Ao final, entregue resumo, arquivos alterados, decisoes, testes, riscos e como testar manualmente.
```

## Estilo de implementação

- Código pequeno e claro.
- Componentes visuais sem regra de negócio pesada.
- Serviços para Firebase, localização, ranking e zonas.
- Funções puras para cálculos críticos.
- Evitar dependência nova sem justificativa.

## Checklist para respostas com código

Antes de sugerir código, validar:

- Qual branch/contexto?
- Qual arquivo será alterado?
- Existe função/componente parecido?
- Isso afeta Firestore?
- Isso afeta permissão/localização?
- Precisa de teste?
- Precisa atualizar documentação?

## Prompt recomendado para o Project

```txt
Este projeto é o contexto central do Wayper.

Sempre que eu pedir algo relacionado ao código, documentação, arquitetura ou decisões do Wayper, use primeiro o repositório conectado no GitHub.

Priorize as fontes nesta ordem:
1. Código atual na branch develop.
2. Código estável na branch main.
3. README.md.
4. Documentação em /docs.
5. Issues e pull requests.
6. Conhecimento geral apenas quando faltar informação.

Ao sugerir mudanças:
- Respeite a estrutura atual do projeto.
- Indique arquivos que provavelmente precisam ser alterados.
- Separe solução rápida de solução robusta.
- Explique riscos técnicos.
- Não invente dependências sem justificar.
- Não exponha segredos, tokens ou credenciais.
- Atualize a documentação quando a mudança afetar regras, arquitetura, deploy ou dados.
```

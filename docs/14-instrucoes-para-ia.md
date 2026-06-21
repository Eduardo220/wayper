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

## Protocolo Obsidian como mente do projeto

O Obsidian e os arquivos Markdown em `/docs` funcionam como a memoria viva do Wayper. O codigo mostra o que esta implementado na branch atual; os Markdown registram intencao, planejamento, decisoes, bugs, ideias, propostas, riscos e proximos caminhos. Uma alteracao relevante no app so fica completa quando o codigo e a documentacao contam a mesma historia.

### Papel das fontes

1. `develop` e a fonte da verdade implementada: antes de afirmar que algo existe, leia o codigo atual e o estado do worktree.
2. `main` representa a referencia estavel/producao quando a pergunta for sobre release.
3. `/docs` e a fonte da intencao, memoria, historico, decisoes, riscos e planejamento do projeto.
4. Conversas externas, notas soltas e conhecimento geral so podem complementar quando nao contradizem codigo e docs.
5. Propostas novas precisam de validacao do Eduardo antes de virar implementacao.

### Arquivos para consultar sempre

- `docs/00-fontes-do-projeto.md`
- `docs/14-instrucoes-para-ia.md`
- `docs/24-resumo-rodada-local-first.md`
- `docs/13-bugs-conhecidos.md`
- `docs/16-ideias-de-melhoria.md`
- `docs/17-propostas-pendentes.md`
- `docs/wayper/12-ideias-futuras.md`
- `docs/04-arquitetura.md`
- `docs/08-decisoes-tecnicas.md`
- `docs/10-regras-de-negocio.md`
- `docs/12-guia-de-testes.md`
- `docs/wayper/00-index.md`
- `docs/wayper/09-arquitetura-tecnica.md`
- `docs/wayper/10-decisoes-do-projeto.md`

Consulte tambem docs de dominio conforme a tarefa: roadmap, backlog, modelo de dados, fluxos, padroes de codigo, permissoes/onboarding, GPS, corrida, Firestore, sharing, diagnostico ou qualquer arquivo citado por uma decisao anterior.

### Antes de alterar

- Confirmar branch `develop` e revisar `git status --short`.
- Ler o codigo atual envolvido e procurar implementacao parecida.
- Ler os docs relevantes do dominio afetado.
- Verificar `docs/13-bugs-conhecidos.md`.
- Verificar `docs/16-ideias-de-melhoria.md`.
- Verificar `docs/17-propostas-pendentes.md`.
- Verificar `docs/wayper/12-ideias-futuras.md`.
- Verificar se a tarefa ja esta registrada no backlog, roadmap, decisoes tecnicas ou decisoes do projeto.
- Identificar services, hooks, repositories, componentes, storages e helpers existentes antes de propor qualquer novo arquivo.

### Durante a alteracao

- Implementar apenas o que foi pedido ou aprovado explicitamente.
- Nao executar ideia pendente sem autorizacao do Eduardo.
- Nao transformar ideia em tarefa ativa sem decisao humana.
- Nao criar feature paralela, service paralelo, repository paralelo, hook paralelo, storage paralelo ou componente duplicado.
- Refatorar/completar o caminho existente quando ja houver implementacao parcial.
- Preservar local-first e Firestore como remoto/best effort nos fluxos ja consolidados.
- Preservar diferenca entre implementado, em validacao, pendente de decisao, ideia futura, bug conhecido, proposta aprovada e proposta rejeitada.
- Nao alterar arquivos locais/visuais do Obsidian, como `docs/.obsidian/workspace.json`, `graph.json`, cache, plugins, temas ou arquivos equivalentes.

### Depois da alteracao

- Atualizar docs tecnicos afetados pelo comportamento alterado.
- Atualizar bug conhecido se corrigiu, reproduziu ou encontrou problema.
- Registrar decisao tecnica quando houver mudanca de arquitetura, regra, sync, dados, permissao, diagnostico ou fluxo critico.
- Registrar em `docs/16-ideias-de-melhoria.md` pelo menos uma oportunidade real relacionada a uma alteracao relevante, salvo mudanca puramente mecanica e justificada.
- Registrar em `docs/17-propostas-pendentes.md` quando a oportunidade ja tiver escopo de proxima tarefa e precisar de decisao do Eduardo.
- Registrar em `docs/wayper/12-ideias-futuras.md` quando a oportunidade for maior, de medio/longo prazo ou depender de backend/sync remoto/validacao real.
- Documentar testes, validacao manual, riscos e pendencias.
- Deixar claro o que esta implementado, em validacao, pendente ou apenas sugerido.

### Convencao de status

Use estes status em bugs, ideias, propostas, decisoes e docs de acompanhamento:

- `AGUARDANDO_VALIDAÇÃO_EDU`: sugestao registrada; Eduardo ainda nao decidiu.
- `APROVADO`: Eduardo aprovou a proposta ou decisao.
- `EM_IMPLEMENTAÇÃO`: trabalho autorizado esta em andamento.
- `IMPLEMENTADO`: codigo ou documentacao foi entregue.
- `EM_VALIDAÇÃO`: entregue, mas ainda precisa validacao manual, real ou de produto.
- `REJEITADO`: Eduardo rejeitou ou a ideia foi descartada com motivo.
- `ADIADO`: valido, mas fora da rodada atual.
- `BLOQUEADO`: depende de credencial, aparelho, decisao, backend, dado real ou contexto externo.
- `LEGADO`: existe para compatibilidade/historico; nao e fonte oficial nova.
- `CORRIGIDO`: bug corrigido com evidencia registrada.
- `PRECISA_TESTE_REAL`: nao pode ser encerrado sem teste fisico ou ambiente real.
- `PENDENTE_DECISÃO`: proposta com escopo claro aguardando decisao do Eduardo.

Quando o arquivo precisar ficar 100% ASCII por consistencia local, use as grafias sem acento `AGUARDANDO_VALIDACAO_EDU` e `PENDENTE_DECISAO` como equivalentes operacionais.

### Bugs

Bugs pertencem a `docs/13-bugs-conhecidos.md`. Nao apague bug conhecido sem registrar motivo. Ao corrigir, mova para "Bugs corrigidos" ou altere o status para `CORRIGIDO`, incluindo correcao aplicada, evidencia e teste necessario. Se o bug exige aparelho fisico, build release, credenciais ou ambiente externo, mantenha como `PRECISA_TESTE_REAL`, `BLOQUEADO` ou `EM_VALIDAÇÃO` ate haver evidencia.

### Ideias

Ideias pertencem a `docs/16-ideias-de-melhoria.md`. Ideia nao e tarefa aprovada. Toda ideia criada pela IA deve ter origem, tarefa relacionada, arquivos afetados quando conhecidos, data, status, proximo passo e, quando util, prompt futuro sugerido. Ideias geradas ao final de uma alteracao relevante devem ser uteis, especificas e relacionadas ao que mudou.

### Propostas pendentes

Propostas pertencem a `docs/17-propostas-pendentes.md`. Use proposta quando a ideia ja tem escopo executavel, criterios de aceite e decisao necessaria do Eduardo. Proposta pendente nao pode ser implementada automaticamente. Se Eduardo aprovar, registre a decisao, atualize status para `APROVADO` ou mova para "Propostas aprovadas", e so entao implemente quando solicitado.

### Ideias futuras

Ideias maiores, de medio/longo prazo, dependentes de backend/sync remoto, validacao real ou mudanca de produto pertencem a `docs/wayper/12-ideias-futuras.md`. Elas nao entram no backlog ativo sem aprovacao explicita. Nao documente sync remoto como implementado quando existe apenas estrutura local `PENDING_SYNC`.

### Regra da ideia final obrigatoria

Ao final de toda alteracao relevante no app, registre uma oportunidade de melhoria em `docs/16-ideias-de-melhoria.md`:

- A ideia deve estar relacionada ao que foi alterado.
- A ideia deve ter utilidade real para produto, qualidade, operacao, diagnostico ou UX.
- O status inicial deve ser `AGUARDANDO_VALIDAÇÃO_EDU`.
- A ideia nao pode ser implementada automaticamente na mesma rodada.
- O proximo passo deve deixar claro como Eduardo valida, rejeita ou converte em proposta.

Se a mudanca for puramente mecanica, formatacao, renomeacao sem impacto de produto ou ajuste sem aprendizado novo, registre na entrega que nao houve ideia relevante e explique o motivo.

### Regra de decisao do Eduardo

- Codex pode sugerir.
- Codex pode registrar.
- Codex pode organizar.
- Codex nao pode aprovar sozinho.
- Codex nao pode transformar proposta em implementacao sem pedido explicito.
- Eduardo decide o que entra na proxima rodada, o que fica adiado e o que e rejeitado.

### Rastreabilidade

Use IDs previsiveis quando registrar novas entradas:

- `BUG-YYYYMMDD-001`
- `IDEA-YYYYMMDD-001`
- `PROP-YYYYMMDD-001`
- `FUTURE-YYYYMMDD-001`

Toda ideia/proposta/bug/futuro deve mencionar origem, tarefa relacionada, arquivos afetados quando souber, data, status e proxima acao.

### Checklist pos-alteracao

- [ ] Atualizei docs tecnicos afetados?
- [ ] Atualizei bugs conhecidos, se corrigi/encontrei bug?
- [ ] Registrei decisao tecnica, se houve mudanca de arquitetura?
- [ ] Registrei pelo menos uma ideia de melhoria relacionada?
- [ ] Se a ideia exige aprovacao como proxima tarefa, deixei em propostas pendentes?
- [ ] Marquei claramente o que esta implementado vs pendente?
- [ ] Rodei testes relevantes?
- [ ] Documentei riscos?
- [ ] Nao alterei `.obsidian` local/visual?
- [ ] Nao implementei ideia nao aprovada?

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

# AI HARNESS BASELINE — PRE-CLEANUP SNAPSHOT

> **Status documental:** `PRE-CLEANUP SNAPSHOT`. Este arquivo preserva a fotografia
> factual anterior à consolidação da `develop`; não descreve o estado Git atual
> depois da limpeza. Use o Git e a entrega da missão de cleanup como fontes do
> estado posterior. O inventário externo do Harness permanece evidência útil para
> a futura Unidade 2, sem autorizar sua cópia ou consolidação nesta etapa.

> **Sucessor canônico:** a Unidade 2 foi consolidada em
> [`docs/ai/harness-v1.md`](../ai/harness-v1.md). O inventário e as decisões atuais
> estão em
> [`2026-08-16-ai-harness-v1-foundation.md`](2026-08-16-ai-harness-v1-foundation.md);
> o restante deste arquivo continua sendo somente a fotografia pré-cleanup.

> **Data da fotografia:** 2026-08-16<br>
> **Escopo observado:** filesystem atual de `/home/eduardo/Wayper` e repositório mobile `/home/eduardo/Wayper/wayper`<br>
> **Tipo:** auditoria factual, sem implementação do Harness<br>
> **Autoridade usada:** source, testes, manifests e configuração do checkout observado; documentação como direção ou evidência datada<br>
> **Alterações desta unidade:** somente este documento

## 0. Resumo executivo e limites da fotografia

O Wayper já possui um AI Harness Codex substancial no filesystem observado. A
premissa de executar esta unidade antes de introduzir `AGENTS.md`, skills,
custom agents, hooks e orquestração não corresponde ao estado atual:

- há `AGENTS.md` no workspace e no app mobile;
- há nove skills de projeto, incluindo um roteador (`wayper-brain`);
- há quinze custom agents;
- há configuração de agentes, mapas estruturais, benchmarks e Graphify;
- há hook Codex/RTK registrado na configuração global do usuário;
- há hooks Git `post-commit` e `post-checkout` do Graphify no repositório mobile;
- a sessão que produziu esta auditoria utilizou o Master, `wayper-brain`, um
  mapper, um tester, Graphify e RTK.

Esse Harness não está em uma base de versionamento única. O workspace raiz não
é repositório Git; o `AGENTS.md` mobile está não rastreado no checkout local; os
hooks Git ficam em `.git/hooks`; e a ativação RTK/Ponytail depende de configuração
global em `~/.codex`. A primeira decisão das próximas unidades não deve ser criar
outro Harness, e sim definir procedência, ownership e versionamento do que já
existe.

Esta fotografia também não representa um `develop` limpo ou sincronizado. Ela
representa exatamente o checkout local observado:

- branch local `develop`;
- HEAD `090880265ad6138fcfd0583fc4479355b767835c` (`0908802`);
- upstream `origin/develop` doze commits à frente;
- 89 entradas no status expandido antes deste documento: 32 modificações
  rastreadas, 2 deleções rastreadas e 55 arquivos não rastreados;
- nenhum arquivo staged;
- o filesystem é um composto divergente: entre os 99 caminhos que diferem de
  `origin/develop`, somente 21 eram byte-identical ao blob remoto, 78 tinham
  conteúdo local diferente e nenhum estava fisicamente ausente.

Portanto, “código atual da develop” neste documento significa **HEAD local mais
working tree observado**, não `origin/develop`, release ou produção. Nenhum
fetch, pull, checkout, reset, clean, commit ou push foi executado.

## 1. Estado do Git e estrutura principal

### 1.1 Git

| Item | Evidência |
| --- | --- |
| Repositório alvo | `/home/eduardo/Wayper/wayper` |
| Branch | `develop` |
| HEAD | `090880265ad6138fcfd0583fc4479355b767835c` |
| Último commit local | `docs(process): add obsidian project memory protocol`, 2026-06-20 |
| Upstream | `origin/develop`, `+0/-12` no status local |
| Staged | nenhum |
| Working tree inicial | 32 modificados, 2 deletados, 55 não rastreados; hash do status expandido `86bfedf1244a363483776248563a1e387bd3abfa21a7e4a646c20daa92c52679` |
| Diff rastreado inicial | 34 arquivos, 1.843 inserções e 385 deleções, além de 2 PDFs deletados |
| Avisos Git | conversão CRLF→LF anunciada para `App.js`, `eas.json`, `scripts/run-expo-android-device.cjs`, `scripts/run-gradle.cjs`, `src/navigation/MainNavigator.js` e `src/screens/MapScreen.js` |

### 1.2 WIP pré-existente

Os arquivos modificados/não rastreados são trabalho do usuário e foram
preservados. Os grupos observados antes deste relatório são:

| Grupo | Caminhos principais |
| --- | --- |
| Ambiente/build | `.env.example`, `.gitignore`, `.nvmrc`, `eas.json`, `package.json`, scripts de env/Android/Sentry, plugin Expo |
| Entrada/navegação/UI | `App.js`, `MainNavigator.js`, `MapScreen.js`, `DiagnosticsScreen.js`, `ErrorBoundary.js` |
| Runtime e persistência | `src/tasks/activeRunLocationTask.js`, `activeRunState`, runtime tests, `runFinalizationService`, fila deferida e repository |
| Diagnóstico/Sentry | services, sanitizer, logger e testes associados |
| Documentação | fontes, padrões, decisões, testes, bugs, diagnóstico, `docs/product/`, `docs/architecture/` e auditorias |
| Estado local que não deve ser commitado | `.obsidian/` |
| Deleções | dois PDFs em `scripts/` |

A lista completa permanece recuperável por
`git status --short --untracked-files=all`. Ela não é reproduzida integralmente aqui para evitar que
este documento vire uma segunda fonte do status mutável.

### 1.3 Estrutura principal observada

| Caminho | Papel | Tamanho/quantidade observada |
| --- | --- | --- |
| `App.js`, `index.js` | entrada React Native/Expo | arquivos raiz do app |
| `src/` | produção, testes e tarefas JS | 247 arquivos, ~3,2 MiB |
| `src/screens/` | superfícies de UI | inclui `MapScreen`, Home, perfil, histórico, grupos e amigos |
| `src/services/` | tracking, run, território, diagnóstico, monitoramento, Firebase e serviços legados | principal camada de lógica |
| `src/repositories/` | facades local-first | runs, fila, território, perfil, ranking, progresso e outros domínios |
| `src/tasks/` | entry points headless | task de localização da corrida ativa |
| `src/storage/` | storages auxiliares/legados | inclui zonas legadas |
| `android/` | projeto nativo e artefatos gerados | 9.130 arquivos, ~13 GiB; a maior parte é build gerado |
| `docs/` | direção, operação, auditorias e memória | 89 arquivos, ~800 KiB |
| `scripts/` | env, Android, instalação, diagnóstico | 15 arquivos, ~88 KiB |
| `assets/` | ícones e imagens | 16 arquivos, ~680 KiB |
| `dist/` | artefatos gerados | 50 arquivos, ~865 MiB |

## 2. Infraestrutura de IA existente

### 2.1 Inventário e destino recomendado

| Item | Propósito factual | Uso atual | Redundância/risco | Destino futuro |
| --- | --- | --- | --- | --- |
| `/home/eduardo/Wayper/AGENTS.md` | Master orchestration, limites entre repos, delegação, evidência e conclusão | ativo; governou esta auditoria | está fora de qualquer Git; falha de procedência e portabilidade | **manter**; versionar em ownership explícito de infraestrutura compartilhada, sem copiá-lo para os dois apps |
| `wayper/AGENTS.md` | regras mobile, fontes e invariantes de corrida/local-first | ativo; é o nearest `AGENTS.md` do app | não rastreado no checkout e diferente de `origin/develop` | **manter e migrar para estado versionado** depois de reconciliar o Git |
| `AGENTS.override.md` | override local | não existe | nenhum | **não criar** sem necessidade concreta |
| `CLAUDE.md` | instrução Claude | não existe no escopo ativo | integração atual é Codex-only por decisão local | **não criar**; manter Codex-only |
| `.agents/skills/` | nove skills on-demand | ativo; `wayper-brain` e `graphify` foram usados nesta unidade | diretório raiz fora de Git; sobreposição só existe se skills forem carregadas indiscriminadamente | **manter** com ownership/versionamento; preservar carregamento seletivo |
| `.codex/agents/` | quinze perfis especializados | ativo; `wayper_mapper` e `wayper_tester` foram executados | muitos papéis aumentam custo de manutenção, mas o benchmark atual justifica roteamento seletivo | **manter** por ora; revisar somente com dado de uso/qualidade |
| `.codex/config.toml` | habilita agentes, limite 6, defaults e profundidade 1 | ativo | fora de Git e dependente da versão Codex | **manter**; versionar e testar compatibilidade por versão |
| `.codex/maps/` | oito mapas seletivos de workspace/mobile/site/riscos | disponível; metadata declara `PARTIALLY_STALE_WITH_REASON` | gerado/temporal, não autoridade | **manter como cache gerado**, regenerar quando a fonte reconciliada mudar |
| `.codex/benchmarks/` | seis registros offline de tuning do Harness | não carregado em tarefas normais | fica obsoleto após mudança de Codex/modelo/arquitetura | **manter como evidência histórica** e arquivar quando supersedido |
| `graphify-out/` | graph, relatório, HTML, manifest, memória e snapshots datados | ativo; uma query orientou o mapper | ~6,2 MiB só no `graph.json`; parcial staleness; snapshots duplicam armazenamento | **manter como artefato gerado local**; definir retenção para snapshots `2026-*` |
| `.graphifyignore` | exclui Git, deps, builds, secrets, mídia, estado local e corpus adversarial | ativo no build do grafo | inclui `.agents/.codex`, então o grafo não audita o próprio Harness | **manter**; auditar Harness diretamente, como nesta unidade |
| hooks Git `post-commit` e `post-checkout` | rebuild incremental/full do Graphify no grafo compartilhado | instalados e executáveis; não disparados nesta auditoria | ficam em `.git/hooks`, não versionados; dependem de Python/Graphify e caminho absoluto | **manter**, mas migrar para instalador/check verificável e documentação de bootstrap |
| `.codex/hooks/rtk-codex.js` | adapta envelope RTK para hook Codex | ativo via `~/.codex/hooks.json`, com hash trusted | arquivo no workspace + registro global; dependência não portátil | **manter**; documentar instalação e fallback explícito `rtk` |
| `/home/eduardo/.codex/RTK.md` e `RTK.md` | política de compressão transparente de shell | ativos | duas cópias com níveis de detalhe diferentes | **migrar para uma fonte normativa + resumo local**, evitando drift |
| `skills-lock.json` | pin/hash da skill Caveman | presente | cobre somente Caveman, não as skills Wayper | **manter**; decidir se skills Wayper serão lockadas/versionadas por outro mecanismo |
| Ponytail plugin global | menor implementação correta | ativo na configuração global e nesta sessão | não vive no projeto; hook global afeta reprodutibilidade | **manter como dependência externa declarada**, nunca copiar sua política inteira |
| Superpowers plugin global | métodos de processo, subordinados ao Brain | habilitado globalmente e referenciado pelo Brain | não foi necessário nesta auditoria; risco de processo duplicado se usado sem roteamento | **manter sob roteamento do Brain** |
| `docs/14-instrucoes-para-ia.md` | protocolo detalhado para agentes | ativo; `AGENTS.md` o referencia sob demanda | longo e parcialmente redundante com AGENTS | **manter**, mas limitar a detalhes operacionais; AGENTS deve continuar como router curto |
| `docs/wayper/11-prompts-para-ia.md` | prompt histórico para Codex/Claude/GPT | histórico; não é fonte canônica atual | contradiz `docs/00` ao dizer que `docs/wayper` é fonte de verdade | **migrar conteúdo ainda único e depois deprecar/remover**, nunca agora |
| `docs/20-backlog-ia.md` | backlog de sugestões da IA | registro de planejamento | contém afirmação antiga de que `docs/wayper` é canônico | **manter como histórico/planejamento**, corrigir procedência em unidade documental futura |
| `docs/21-exemplos-de-comandos-ia.md` | exemplos de entradas formais | utilizável manualmente | sobreposição de workflow com AGENTS/Brain | **manter apenas como guia do usuário**; não usar como regra de runtime |
| `.agents/` e `.codex/` dentro de `wayper/` | diretórios vazios | sem função observável | sugerem Harness aninhado inexistente | **remover no futuro se continuarem vazios**, após confirmar que nenhuma ferramenta depende deles |

### 2.2 Skills existentes

As nove skills encontradas são:

1. `wayper-brain` — classificação, orçamento, processo, dispatch e validação;
2. `graphify` — descoberta estrutural e grafo persistente;
3. `caveman` — compressão de comunicação;
4. `wayper-active-run` — lifecycle da corrida ativa;
5. `wayper-persistence-sync` — finalização, fila e sync pós-corrida;
6. `wayper-territory-map` — geometria, captura e mapa territorial;
7. `wayper-mobile-shell` — app entry, auth gate, navegação e permissões de entrada;
8. `wayper-site-motion-webgl` — runtime visual do site;
9. `wayper-site-design-content` — contrato estático do site.

O conjunto já funciona como context router seletivo. Criar outro router sem
medir uma lacuna duplicaria responsabilidade.

### 2.3 Custom agents existentes

Os quinze perfis são:

- descoberta/execução: `wayper_mapper`, `wayper_researcher`, `wayper_tester`,
  `wayper_debugger`, `wayper_architect`, `wayper_implementer`;
- revisão geral/integração: `wayper_reviewer`, `wayper_final_reviewer`;
- revisão especializada: `wayper_concurrency_reviewer`,
  `wayper_mobile_lifecycle_reviewer`, `wayper_persistence_reviewer`,
  `wayper_geospatial_reviewer`, `wayper_web_performance_reviewer`,
  `wayper_security_reviewer`;
- exceção premium: `wayper_adjudicator`.

Os perfis impõem master único, ausência de delegação recursiva, um writer por
superfície e source verification. Mapper, researcher e tester usam Luna/low;
security usa Terra/high; adjudicator usa Sol/high; os demais herdam o default
Terra/medium salvo override permitido.

### 2.4 Hooks e MCPs

Hooks comprovados:

- Codex `PreToolUse` para Bash, registrado em
  `/home/eduardo/.codex/hooks.json`, chama o adapter RTK do workspace;
- hooks lifecycle do plugin Ponytail, registrados como trusted na configuração
  global;
- Git `post-commit` e `post-checkout` do Graphify no app mobile.

Não foi encontrada configuração MCP ativa no projeto ou na configuração Codex
de projeto. A skill Graphify oferece MCP opcional, mas o flag/servidor não está
configurado; capacidade documentada não é instância em uso.

## 3. Matriz da documentação

| Assunto | Fonte canônica/direção | Arquivo | Atualizado? | Código/config que confirma ou contradiz |
| --- | --- | --- | --- | --- |
| Hierarquia de fontes | router mobile | `docs/00-fontes-do-projeto.md` | atual para o working tree, mas modificado e não consolidado em commit local | confirma que source vence docs e que `runFinalizationService` é WIP sem import de produção |
| Visão do produto | direção estratégica + recortes | `docs/product/direcao-estrategica-completa.md`, `docs/product/00-visao-oficial.md`, `docs/01-visao-do-produto.md` | vigente como direção; `docs/product` está não rastreado no checkout | local-first, corrida como ação e pós-corrida como jogo aparecem nos services; produto completo não está todo implementado |
| Roadmap | planejamento | `docs/02-roadmap.md` | parcialmente atual; não é evidência de conclusão | source confirma corrida/recovery/local-first; testes físicos, release/Sentry e social offline continuam pendentes |
| Backlog | planejamento | `docs/03-backlog.md` | parcialmente atual | direct Firestore em Feed/Friends/Groups, AsyncStorage e validação Android pendente confirmam os itens abertos |
| Arquitetura | estado + ADRs aceitas | `docs/04-arquitetura.md`, `docs/architecture/*.md` | parcial; `docs/architecture` está não rastreado | source confirma services/repositories/local-first; `MapScreen` e imports Firestore em UI contradizem separação ideal |
| Modelo de dados | estado observado | `docs/05-modelo-de-dados.md` | atual para chaves centrais; contratos futuros/derivados exigem source check | `wayper:activeRun:v2`, `runs`, storages territoriais e fila aparecem no source; vários storages legados ainda existem |
| Fluxos de usuário | estado + direção | `docs/06-fluxos-de-usuario.md` | majoritariamente atual, com limitações | MapScreen executa start/pause/resume/finish/recovery; finish ainda salva diretamente por `sync.saveLocalRun` e fila deferida |
| Padrões de código | regra operacional | `docs/07-padroes-de-codigo.md` | orientação atual | contradito por Firestore direto em telas, business logic em `MapScreen` e god objects; confirma nomes/camadas existentes |
| Decisões técnicas | ADRs aceitas | `docs/08-decisoes-tecnicas.md`, `docs/architecture/adrs-direcao-oficial.md` | substância recente, organização inconsistente | source confirma ADRs de active run, GPS, notificação, save mínimo e Sentry; há ID `ADR-016` duplicado e ordem 026/024/025 |
| Regras de negócio | direção aprovada | `docs/10-regras-de-negocio.md`, `docs/product/10-decisoes-aprovadas.md` | atual como direção | source preserva corrida local-first, free/zones, save antes de derivados; implementação do pós-corrida completo é parcial |
| Testes | source dos testes + guia | `src/**/__tests__`, `docs/12-guia-de-testes.md` | guia útil, contagem stale | doc cita 49 suites/428 testes de 2026-06-19; checkout lista 57 suites e a execução atual falha em duas |
| Bugs/riscos | registro vivo | `docs/13-bugs-conhecidos.md` | coerente com riscos atuais, mas modificado | Android físico, Sentry/source maps, social Firestore-first, AsyncStorage e legados permanecem observáveis |
| Instruções IA | AGENTS como router; doc detalhado | `AGENTS.md`, `docs/14-instrucoes-para-ia.md` | ativo | a sessão atual aplicou ambos; `docs/wayper/11-prompts-para-ia.md` contradiz a hierarquia nova |
| Diagnóstico/Sentry | docs de domínio | `docs/diagnostics.md`, `docs/share-debug.md`, ADR Sentry | atual para WIP observado; validação externa aberta | services centralizados e testes existem; credenciais, painel, source maps e aparelho real não foram validados |
| Runtime/recovery | source + auditorias datadas | auditorias 2026-08-01 Unidades 2.5, 3 e 4 | contratos continuam relevantes; resultados de teste são históricos | `activeRunState`, runtime, task e testes confirmam desenho; full suite atual falha e não herda o “56 suites/623 testes” da árvore exata anterior |
| Finalização | source ativo + direção de save mínimo | auditoria fase D, ADR-026, `docs/24-resumo-rodada-local-first.md` | parcial/WIP | `MapScreen` usa `sync.saveLocalRun` e fila deferida; `runFinalizationService` existe e tem testes, mas não é importado pelo caminho de produção |
| Deploy/comandos | manifests/scripts | `package.json`, `app.json`, `eas.json`, Android; `docs/11-plano-de-deploy.md` como guia | package é autoridade; docs são operacionais | scripts atuais existem; nenhum build/release/device foi executado nesta unidade |

Notas documentais:

- `docs/audits/` é evidência temporal, não norma permanente;
- `docs/wayper/` é histórico/parcial, não fonte canônica isolada;
- os resultados de testes de auditorias anteriores só valem para a árvore/índice
  exatos citados por elas;
- documentação não rastreada ou modificada pode refletir WIP, não decisão já
  integrada ao `develop` local.

## 4. Comandos canônicos observados

Fonte principal: `package.json`; README/docs foram usados apenas para o comando
de instalação e contexto operacional. Todos devem ser executados dentro de
`wayper/`.

| Objetivo | Comando real | Observação |
| --- | --- | --- |
| Instalar | `npm install` | documentado no README/deploy; não há script `install` específico; lockfile npm v3 existe |
| Testes | `npm test` | Jest com Node VM modules e `--runInBand` já embutido no script |
| Teste específico | `npm test -- <caminho-do-teste> --runInBand` | padrão usado no guia; não há script dedicado por domínio |
| Lint | inexistente | não há script `lint` nem dependência ESLint observada |
| Typecheck | inexistente | não há script `typecheck`; app é JavaScript sem configuração TS observada |
| CI/validate | inexistente | não há `test:ci` ou `validate` |
| Dev padrão | `npm run dev` | Metro localhost + localização opcional + emulator devDebug |
| Dev limpo | `npm run dev:clean` | limpa cache Metro |
| Metro/dev client | `npm start` | Expo dev client com `.env.development` |
| Android emulator | `npm run dev:android` ou `npm run dev:emulator` | o segundo coordena Metro, localização e Android |
| Android físico | `npm run dev:phone` | LAN + device devDebug |
| Campo/rua | `npm run rua` | tunnel; aliases `teste:rua`, `rua:usb`, `rua:install` também existem |
| APK dev | `npm run dev:apk` | Gradle dev + cópia para `dist` |
| Build Android dev | `npm run android:build:dev` | configura flavors e roda `assembleDevDebug` via script Gradle |
| APK produção | `npm run prod:apk` | prodRelease com fluxo Sentry normal |
| APK produção sem source maps | `npm run prod:apk:no-sourcemaps` | define `SENTRY_DISABLE_AUTO_UPLOAD=true` |
| AAB produção | `npm run prod:aab` | `bundleProdRelease` |
| EAS | `npm run eas:dev`, `eas:preview`, `eas:prod` | usa `npx eas-cli` e perfis declarados |
| Diagnóstico Sentry | `npm run sentry:check-config` | valida configuração; não prova evento entregue/simbolicado |
| Evento Sentry orientado | `npm run sentry:test` | o próprio guia diz que não envia sozinho nem imprime token |
| Gate de diff | `git diff --check` | documentado, não é script npm |
| Validação corrida | `npm run teste:emulador`, `teste:celular`, `teste:rua` + checklists | não existe comando único automatizado; `docs/22-*` e `docs/wayper/15-*` exigem aparelho/observação |

O script `clean` atual é Windows-specific, apaga `node_modules` e
`package-lock.json` e reinstala dependências. Não foi executado e não deve ser
tratado como instalação segura/canônica em auditorias.

## 5. Mapa dos domínios críticos

### 5.1 Fluxo macro observado

```text
MapScreen / MainNavigator / notificação
  -> activeRunRuntimeService (reentrada/reconciliação)
  -> activeRunTrackingService
  -> activeRunState + AsyncStorage (`wayper:activeRun:v2` e chunks)
  -> tracking pipeline + foreground watcher + Expo Location task
  -> Android foreground service / notificação persistente
  -> recovery/checkpoint
  -> finalização hoje orquestrada em MapScreen
  -> sync.saveLocalRun (`runs`) antes de derivados
  -> fila persistente de tarefas derivadas
  -> sync remoto/Firestore best effort
```

### 5.2 Matriz de ownership real

| Domínio | Entradas | Serviços/estado centrais | Dependências | Testes | Docs | Riscos observados |
| --- | --- | --- | --- | --- | --- | --- |
| Corrida ativa | `MapScreen`, ação de notificação, cold start/focus | `activeRunTrackingService`, `activeRunState` | AsyncStorage, tracking, diagnostics, notification | active run tracking/state/lifecycle | docs 04/05/08, auditorias 2.5–4 | serviço muito consumido; múltiplas chaves snapshot/meta/chunks |
| Estado canônico | callers do tracking/runtime | `wayper:activeRun:v2`, normalização/merge/reconcile em `activeRunState` | storage local | `activeRunState.test.js`, reconciler/lifecycle | docs 05, ADR-007/008 | UI ainda orquestra muitos efeitos, embora não seja fonte de verdade |
| GPS foreground | `MapScreen` e watcher | `locationService`, `expoLocation`, `activeRunTrackingService.recordLocation`, `src/services/tracking/*` | Expo Location, configs de tracking | tracking/path/render tests | ADR-010, docs 12/22 | caminho crítico cruza service grande e tela grande |
| Background/headless | `src/tasks/activeRunLocationTask.js`, task `WAYPER_ACTIVE_RUN_LOCATION` | `handleActiveRunLocationTask` e lifecycle no tracking service | Expo TaskManager/Location | lifecycle/tracking tests | auditorias 2.5–4 | teste atual não parseia ESM de `expo-task-manager`; validação física pendente |
| Foreground service Android | bridge JS/notificação | `RunNotificationForegroundService.kt`, module/action service/receiver | Android service `location`, bridge RN | `runNotificationService.test.js` | ADR-009, docs 22 | OEM/bateria; reconciliação JS↔nativo; sem gate físico atual |
| Notificação persistente | active snapshot e ações pause/resume | `runNotificationService`, `WayperRunNotificationModule` | Android native, active tracking | notification tests | ADR-009, docs diagnostics | ação precisa preservar owner/generation; finish continua no app |
| Pause/resume | botões `MapScreen` e notificação | `pauseActiveRun`, `resumeActiveRun` | lifecycle serializado, autosave, notification | lifecycle/tracking/notification | auditoria Unidade 3 | `MapScreen` continua caller direto e superfície de timing/UX |
| Finish | `MapScreen` | caminho ativo usa checkpoint/snapshot, `sync.saveLocalRun`, fila deferida; `runFinalizationService` é WIP não importado | sync, offline storage, queue, território/XP deferidos | finalization/queue tests existem | ADR-026, fase D, docs 00/24 | implementação paralela parcial: service modular existe, tela ainda contém fluxo terminal |
| Recovery | cold start, focus, foreground, notificação | `activeRunRuntimeService.reconcileActiveRunState`, `runRecoveryService` | canonical + legacy snapshot, native task, notification | recovery/runtime/lifecycle | auditoria Unidade 4 | export esperado por teste está ausente; partial states devem preservar evidência |
| Persistência offline | active state, autosave e finish | `runOfflineStorageService`, `runAutoSaveService`, `sync.js`, finalization/queue services | AsyncStorage e filesystem diagnóstico | autosave/local-first/finalization/sync | docs 05/24 | AsyncStorage scaling; legado `runService.js`; responsabilidades sobrepostas |
| Reconciliação | runtime/cold start e merge de runs | state reconciler, runtime, recovery, `sync.js` | identidade/aliases/timestamps | reconciler/runtime/sync tests | auditorias e ADRs | alto risco de duplicação/ressurreição se bypassado |
| Diagnostics | logger, run events, screen/export | `runDiagnosticsService`, `localDiagnosticsService`, storage/export/performance services | filesystem NDJSON/ZIP, services de domínio | diagnostics/local/performance | `docs/diagnostics.md` | vocabulário altamente consumido; tela/service grandes; deve permanecer offline |
| Sentry | App/ErrorBoundary/logger bridge | `sentryService`, sanitizer, monitoring bridge | `@sentry/react-native`, env/build metadata | `sentryMonitoring.test.js` | ADR Sentry, deploy/diagnostics | credenciais, painel e source maps não validados; PII sanitization é boundary crítica |
| Território | `MapScreen`, mapa/dashboard, pós-run | TerritoryRepository, storage/capture/geometry/map services | AsyncStorage, Turf, MapLibre, sync best effort | territory services/repository | docs 04/05/08/15 | lógica também em `MapScreen`; geometry service grande; sync social incompleto |
| Mapas | `MapScreen`, `WayperMapLibre` | `territoryMapService`, tracking render path | MapLibre/OpenFreeMap, Turf | render/path/territory tests | ADR-003/004/010 | componente de 1.444 linhas e orquestração de viewport/território na tela |
| Firebase | `firebaseConfig`, services e algumas telas | Auth, `sync.js`, profile/ranking/feed/group services | Firebase Auth/Firestore/Storage | sync/repository tests parciais | docs 04/05/wayper-08 | remoto ainda atravessa UI social; não pode entrar no caminho crítico da corrida |
| Autenticação | App/navigation gate e telas auth | `authService`, Firebase config | Firebase Auth/persistência | cobertura específica não se destacou no inventário | docs 06/23 | identidade amplamente consumida; Firestore de perfil não pode bloquear dados locais |
| Sync | finish, AppState/NetInfo/retry/diagnóstico | `sync.js`, `runSyncQueueService`, repositories, deferred queue | AsyncStorage, NetInfo, Firestore | sync history/queue/integration | ADR-012/013/026 | `sync.js` é god service; filas antigas e nova fila derivada podem ser confundidas |
| UI principal de corrida | navegação `Mapa` | `MapScreen.js` | praticamente todos os domínios acima | serviços têm cobertura; não há suite isolada equivalente ao componente inteiro | docs produto 07, fluxos, wireframes | componente ~5.452 linhas antes dos styles; god object e blast radius alto |

## 6. Baseline de qualidade

### 6.1 Verificações executadas

| Verificação | Resultado atual |
| --- | --- |
| `npm test -- --runInBand` | **falhou** |
| Inventário Jest `--listTests` | 57 suites/arquivos |
| Lint | não executável: script/config não existe |
| Typecheck | não executável: script/config não existe |
| Build Android/produção | não executado; não é necessário nem barato para esta auditoria e pode exigir ambiente/artefatos |
| Device/emulador/rua | não executado |
| Credenciais/Sentry remoto/Firebase real | não executado |

Falhas decisivas da suite:

1. `src/services/runTracking/__tests__/activeRunLifecycleContract.test.js`
   alcança `expo-task-manager/build/TaskManager.js`, que o Jest atual não
   transforma, e falha com `SyntaxError: Cannot use import statement outside a
   module`;
2. `src/services/runTracking/__tests__/activeRunRuntimeService.test.js:161`
   chama `runtimeService.__resetActiveRunRecoveryRuntimeForTests`, mas o export
   não existe no módulo observado.

Também apareceu o warning experimental de VM Modules do Node. Não existe
contagem de warnings de lint porque não existe lint. O baseline anterior de 49
suites/428 testes no guia e os 56 suites/623 testes da auditoria de uma árvore
exata anterior não substituem esse resultado atual.

### 6.2 Tamanho por categoria

Critério JS: `*.js/jsx/ts/tsx`; produção exclui `__tests__`, `.test.*` e
`.spec.*`. Android exclui qualquer `build/`. Contagens usam comparação estrita
`>`.

| Categoria | Arquivos contados | >350 | >500 | >750 | >1000 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `src` produção | 190 | 56 | 44 | 24 | 11 |
| testes em `src` | 57 | 15 | 5 | 2 | 2 |
| Android nativo/config sem `build` | 29 | 1 | 0 | 0 | 0 |
| configs/scripts selecionados, sem lockfile/Obsidian/gerados | 19 | 0 | 0 | 0 | 0 |

Separação de gerados/assets:

| Categoria excluída da dívida manual | Evidência |
| --- | --- |
| `.expo/` | 3 arquivos, ~12 KiB |
| `dist/` | 50 arquivos, ~865 MiB |
| `android/build/` | 4 arquivos, ~172 KiB |
| `android/app/build/` | 6.378 arquivos, ~11 GiB |
| `assets/` | 16 arquivos, ~680 KiB; mídia não participa da métrica de linhas |
| `package-lock.json` | 16.531 linhas; lockfile gerado, não dívida de fonte manual |

### 6.3 Maiores arquivos de produção

| Linhas | Arquivo |
| ---: | --- |
| 7.155 | `src/screens/MapScreen.js` |
| 2.280 | `src/utils/sync.js` |
| 1.975 | `src/services/runTracking/activeRunTrackingService.js` |
| 1.566 | `src/screens/Runs/RunDetailScreen.js` |
| 1.468 | `src/screens/ProfileScreen.js` |
| 1.444 | `src/components/Map/WayperMapLibre.js` |
| 1.436 | `src/screens/HomeScreen.js` |
| 1.165 | `src/services/run/runDeferredTaskQueueService.js` |
| 1.089 | `src/services/territory/territoryGeometryService.js` |
| 1.083 | `src/screens/Friends/FriendsScreen.js` |
| 1.059 | `src/screens/RankingScreen.js` |
| 965 | `src/services/runTracking/activeRunState.js` |
| 944 | `src/screens/Group/GroupsScreen.js` |
| 920 | `src/components/Home/ActivityFeedCard.js` |
| 873 | `src/screens/DiagnosticsScreen.js` |
| 856 | `src/components/Runs/RunSummaryModal.js` |
| 853 | `src/services/monitoring/sentryService.js` |
| 851 | `src/services/run/runFinalizationService.js` |

Componentes evidentemente grandes por limites sintáticos simples:

- `MapScreen`: declaração na linha 433, export na 5.885, aproximadamente 5.452
  linhas antes dos styles;
- `WayperMapLibre`: linhas 691–1.350, aproximadamente 659;
- `RunDetailScreenInner`: linhas 264–911, aproximadamente 647;
- `ProfileScreen`: linhas 85–703, aproximadamente 618.

Não foi usada uma métrica AST confiável para tamanho de todas as funções;
portanto não há ranking inventado de complexidade ciclomática ou função.

## 7. Arquitetura observada

### 7.1 Acesso de baixo nível

AsyncStorage/storage direto aparece em:

- `firebaseConfig.js` para persistência de auth;
- `src/services/runTracking/*` para snapshot/chunks da corrida ativa;
- `src/utils/sync.js` para histórico/sync;
- `src/services/runService.js` legado;
- `src/services/profileService.js` e onboarding;
- `src/storage/zonesStorage.js` legado;
- services/repositories territoriais e outros storages locais.

Nem todo acesso direto é violação: auth persistence e owners de storage podem
ser boundaries legítimas. O risco é a falta de regra automatizada que permita
owners e bloqueie callers de UI/serviços paralelos.

### 7.2 Firestore direto e cruzamento de camadas

Imports/chamadas diretas de Firestore ainda existem em superfícies de UI social:

- `src/screens/FeedScreen.js`;
- `src/screens/Friends/FriendRunsScreen.js`;
- `src/screens/Friends/FriendsScreen.js`;
- `src/screens/Friends/FriendProfileScreen.js`;
- `src/screens/Group/GroupsScreen.js`;
- `src/screens/Group/GroupDetailScreen.js`;
- `src/screens/Group/GroupChatScreen.js`;
- componentes sob `src/components/Group/`.

Isso confirma a pendência documentada de Feed/Friends/Groups Firestore-first e
cruza a direção screens → repository/service → remoto. Não afeta a fonte
canônica da corrida ativa, mas impede declarar o app inteiro local-first.

### 7.3 Business logic em screens e god objects

`MapScreen` contém lifecycle, permissões/preflight, GPS UI, recovery, finish,
save mínimo, fila deferida, território, mapa, diagnóstico, compartilhamento e
estado visual. Ela é a maior superfície de risco e o exemplo mais claro de
business orchestration dentro de screen.

Outros god-object candidates por tamanho e amplitude:

- `src/utils/sync.js`: local history, normalização, dedupe, retry e Firestore
  para múltiplos domínios;
- `activeRunTrackingService.js`: tracking, snapshot/chunks, lifecycle e task;
- `WayperMapLibre.js`: render, bounds, features e componente;
- telas de detalhe, perfil, home, amigos e ranking acima de mil linhas.

### 7.4 Duplicação/sobreposição de responsabilidade

| Sobreposição | Estado observado |
| --- | --- |
| `runService.js` vs `sync.js`/services local-first | `runService.js` é legado, mas continua presente e pode ser reativado por engano |
| `runFinalizationService` vs finish em `MapScreen` | service e testes existem como WIP; produção não o importa; a tela ainda executa o caminho real |
| snapshot canônico vs checkpoint legado | recovery centraliza conflito, mas múltiplas chaves aumentam complexidade |
| território em services vs `MapScreen` | captura/geometry/repository existem, mas viewport/merge/orquestração ainda vive na tela |
| `sync.js` vs repositories/queues | repositories são facades finas, mas o util continua multi-domínio e altamente consumido |
| instruções AGENTS/docs/prompts | router atual convive com prompts históricos contraditórios |

### 7.5 Serviços de alto blast radius

- `activeRunTrackingService` e `activeRunState` — source canônica e lifecycle;
- `activeRunRuntimeService`/`runRecoveryService` — cold start/reentrada;
- `runDiagnosticsService`/logger — vocabulário transversal de evidência;
- `src/utils/sync.js` — histórico, identidade, fila e remoto;
- `MapScreen` — integração de quase todos os domínios críticos;
- deferred task queue — território/progressão e replay pós-run.

Mudanças futuras nesses pontos precisam de callers, invariantes e testes
targeted; o Harness não deve acrescentar mais consumidores globais sem
necessidade.

## 8. Itens reaproveitáveis

O próximo Harness deve completar e estabilizar estes ativos, não recriá-los:

1. Master/root `AGENTS.md` e mobile `AGENTS.md`;
2. `wayper-brain` como único router de tarefa/contexto/compute;
3. quatro skills mobile com fronteiras já definidas;
4. perfis mapper/tester/implementer/reviewer e reviewers especializados;
5. Graphify compartilhado, maps seletivos e source verification;
6. RTK como redução transparente de shell com raw fallback;
7. Ponytail como disciplina de implementação mínima;
8. matriz de fontes em `docs/00-fontes-do-projeto.md`;
9. docs de domínio e auditorias de runtime/recovery já existentes;
10. testes contratuais de lifecycle/recovery/finalização, depois de restaurar o
    baseline executável;
11. services/repositories local-first existentes como boundaries que futuras
    regras arquiteturais devem reconhecer;
12. hooks Graphify existentes, convertidos em instalação verificável em vez de
    duplicados.

## 9. Itens que faltam

Faltam controles de consolidação, não mais scaffolding:

- fonte Git/ownership para o Harness raiz compartilhado;
- decisão humana sobre qual árvore é a base: WIP local ou `origin/develop`;
- manifesto único de versões mínimas de Codex, Graphify, RTK e plugins;
- bootstrap/doctor reproduzível para registrar hooks globais e Git hooks;
- validação automatizada de TOML/skills/AGENTS e smoke de um dispatch harmless;
- regra de atualização/retention para Graphify, maps, snapshots e benchmarks;
- consolidação de prompts históricos contraditórios;
- baseline Jest verde antes de usar testes como gate do Harness;
- lint/typecheck ou decisão explícita de não tê-los;
- lint arquitetural com allowlist por owner, somente após mapear imports reais;
- CI/validate canônico que não dependa de aparelho ou credenciais;
- métricas de uso/yield para justificar os quinze perfis ao longo do tempo;
- validação Android física para claims de lifecycle, notificação e recovery;
- verificação de Firestore rules/credenciais/source maps fora do ambiente local.

Não foi encontrada lacuna que justifique criar agora outro context router,
outro logger, outro repository, outra fila ou outra fonte de estado.

## 10. Riscos para implementar o Harness

| Risco | Impacto | Mitigação antes de implementar |
| --- | --- | --- |
| Base Git divergente e suja | regras podem ser desenhadas contra um composto que não será integrado | escolher/reconciliar baseline com o usuário; preservar WIP; nunca resetar automaticamente |
| Harness já existe fora de Git | criação paralela e drift entre máquinas | dar ownership/versionamento ao existente |
| AGENTS mobile não rastreado/diferente do remoto | sessões podem obedecer regras diferentes | consolidar conteúdo após decisão de baseline |
| Dependências globais | outra máquina não terá hooks/plugins iguais | bootstrap/doctor idempotente e documentação de instalação |
| Graph parcialmente stale | regra inferida do grafo pode estar errada | source verification obrigatória; refresh só após árvore reconciliada |
| Testes atuais falhando | novo lint/hook pode mascarar regressões antigas | registrar falhas como baseline e corrigir em unidade própria autorizada |
| God objects e imports cruzados | lint ingênuo gera muitos falsos positivos ou bloqueia legado | começar audit-only com allowlist por owner/caminho e ratchet |
| Serviços legados presentes | skills/agents podem escolher caminho antigo | codificar owners canônicos a partir de docs 00 + source/testes |
| Instruções redundantes/contraditórias | agentes recebem prioridades conflitantes | AGENTS curto como router, docs 14 detalhado, deprecar prompt histórico |
| Hooks em `.git/hooks` | invisíveis em clone, podem falhar silenciosamente | instalador verificável, log e opt-out explícito |
| Path absoluto no hook | baixa portabilidade | gerar configuração por workspace resolvido, sem hardcode manual |
| Muitos reviewers | custo sem ganho quando roteados por domínio genérico | selecionar por fingerprint de risco e medir findings reais |
| Dados sensíveis/config local | Harness pode indexar/exportar secrets | manter `.graphifyignore`, sanitização e proibição de dumps |
| Corpus adversarial | prompt injection acidental | manter `scripts/JAILBREAKDEEPSEEK.txt` excluído e tratado somente como dado de teste |
| Android físico não validado | automação pode promover claims falsos | gate manual explícito e status `PRECISA_TESTE_REAL` |

## 11. Ordem recomendada das próximas unidades

1. **Unidade de procedência Git:** decidir com o usuário se a base é o WIP
   local, `origin/develop` ou uma integração explícita; nenhuma limpeza
   automática.
2. **Unidade de ownership/versionamento do Harness:** escolher onde vivem o
   root AGENTS, `.agents`, `.codex`, maps e benchmarks. Migrar o existente, não
   scaffoldar outro.
3. **Unidade de consolidação de instruções:** manter AGENTS como router,
   `docs/14` como protocolo e deprecar contradições de
   `docs/wayper/11-prompts-para-ia.md`/`docs/20-backlog-ia.md`.
4. **Unidade de doctor/bootstrap:** validar versões, TOML, skills, agentes,
   hooks RTK/Graphify e executar smoke read-only. Sem commit/push automático.
5. **Unidade de baseline de testes:** resolver, em tarefa autorizada separada,
   o transform ESM do TaskManager e o export de reset do runtime; depois fixar
   contagem atual.
6. **Unidade de hooks:** transformar os hooks locais existentes em instalação
   idempotente, verificável e portátil; manter Graphify como cache, não
   autoridade.
7. **Unidade de lint arquitetural audit-only:** mapear owners permitidos para
   storage/Firestore e produzir findings sem bloquear. Aplicar ratchet somente
   após revisar falsos positivos.
8. **Unidade de enforcement:** bloquear apenas novas violações comprovadas;
   não exigir refatoração do legado inteiro para ativar o gate.
9. **Unidade de racionalização:** medir uso, custo e findings dos quinze agents
   e nove skills; consolidar apenas redundância demonstrada.
10. **Validação física/externa contínua:** Android real, Sentry/source maps,
    Firebase rules e release permanecem gates separados do Harness local.

O item “context router” não deve gerar uma nova unidade de implementação antes
de provar uma lacuna no `wayper-brain` + matriz de fontes + maps. O sistema já
possui esse papel; a ação mínima é consolidá-lo e testá-lo.

## 12. Conclusão da Unidade 1

Esta unidade termina em diagnóstico. Nenhum código de produção, skill, agent,
hook, regra de lint ou router foi criado/alterado. A fotografia mostra que a
arquitetura de Harness já existe, mas sua procedência e seu baseline Git/testes
não estão consolidados. A próxima unidade segura começa por ownership e
reconciliação, não por adicionar mais infraestrutura.

## 13. Provenance and baseline resolution

Esta seção registra a resolução da Unidade 1.5. Foram usados apenas comandos
read-only de filesystem, Git e Jest. O `origin/develop` foi conferido também
com `git ls-remote`, sem `fetch`, `pull`, merge, rebase, reset, checkout, stash,
stage, commit ou push. Nenhuma correção de produção ou teste foi aplicada.

### 13.1 Root Git e limites do workspace

| Item | Resolução factual |
| --- | --- |
| Workspace aberto | `/home/eduardo/Wayper`; **não é um repositório Git** |
| Root Git do app mobile | `/home/eduardo/Wayper/wayper` |
| App React Native | o próprio root mobile: `App.js`, `index.js`, `src/`, `android/`, `package.json` |
| Outro repositório independente | `/home/eduardo/Wayper/wayper-site` (site Next.js); não é subdiretório versionado do mobile |
| Pasta superior | `/home/eduardo/Wayper` agrega os dois repositórios e o Harness compartilhado, mas hoje não fornece procedência Git a esse Harness |

Logo, há três escopos distintos: repositório mobile, workspace compartilhado
fora de Git e configuração global do usuário. O fato de um arquivo estar sob
`/home/eduardo/Wayper` não significa que ele pertença ao Git do app.

### 13.2 Git provenance e os doze commits remotos

| Campo | Valor verificado em 2026-08-16 |
| --- | --- |
| Branch local | `develop` |
| Remote | `origin` -> `https://github.com/Eduardo220/wayper.git` |
| Upstream | `origin/develop` (`refs/heads/develop`) |
| HEAD local | `090880265ad6138fcfd0583fc4479355b767835c` |
| HEAD remoto | `335ad80938619d8fea76586d33ca6187b5f6c442` |
| Ahead/behind | `0/12` |
| Merge-base | o próprio HEAD local `0908802`; a branch local é ancestral direta da remota |
| Commits locais exclusivos | nenhum |
| Estado da referência | `git ls-remote` confirmou que o HEAD remoto ainda coincide com a referência local `origin/develop` |

Os commits ausentes, em ordem cronológica, são:

| Commit | Assunto | Impacto principal observado |
| --- | --- | --- |
| `ac802b3` | `feat(run): harden active run reliability` | runtime de corrida, task headless, testes, docs, scripts, package/config e Android |
| `9b9d467` | `docs(product): auditar aderencia a nova direcao oficial` | auditoria de produto |
| `bef386b` | `docs(product): consolidar direcao oficial e regras permanentes` | cria `AGENTS.md` no remoto e consolida docs de produto/arquitetura |
| `3d86370` | `docs(test): registrar gate automatizado da fase c` | evidência de testes |
| `658985e` | `feat(run): extrair finalizacao e pipeline da expedicao` | finalização, `MapScreen`, fila e testes |
| `307f1df` | `fix(run): corrigir acoes da notificacao ativa` | notificação e runtime de recovery |
| `c3acc03` | `perf(run): compactar checkpoints e historico local` | tracking, persistência local e histórico |
| `ec8d236` | `fix(run): tornar finalizacao e recovery idempotentes` | finalização/recovery e testes |
| `fc485dd` | `docs(test): registrar gate fisico e remediacoes` | evidência de aparelho físico |
| `4839280` | `docs(test): registrar build do reteste fisico` | evidência de build/reteste |
| `58c16d8` | `fix(run): endurecer transicoes e salvamento final` | lifecycle, save final, native notification e testes |
| `335ad80` | `docs(run): registrar hardening do fluxo critico` | documentação final do hardening |

O intervalo altera **118 arquivos**, com 13.346 inserções e 1.417 deleções:
58 em `docs/`, 40 em `src/`, sete em `scripts/` e treze arquivos adicionais
de entrada, Android, plugin, manifests e configuração. Ele toca explicitamente:

- runtime crítico: active run, background task, foreground service Android,
  notificação, pause/resume/finish, recovery, save offline, filas e sync;
- Harness/IA: adiciona `AGENTS.md` no mobile e altera
  `docs/14-instrucoes-para-ia.md`;
- docs e testes em volume material;
- `package.json`, `package-lock.json`, `app.json`, `eas.json`, `.nvmrc`, scripts
  de ambiente e configuração Expo.

Conclusão: a auditoria anterior continua correta como fotografia do **HEAD
local + working tree observado**, mas não representa uma `develop` remota
limpa. Os doze commits mudam partes centrais da arquitetura de corrida,
testes, documentação e instruções de IA; qualquer uso da fotografia precisa
preservar essa qualificação.

### 13.3 Classificação das 89 alterações pré-existentes

O documento desta auditoria virou a 90ª entrada não rastreada durante o trabalho.
A classificação abaixo exclui deliberadamente esse próprio arquivo e reproduz
o baseline de 89 entradas, cujo hash continua
`86bfedf1244a363483776248563a1e387bd3abfa21a7e4a646c20daa92c52679`.
Nada está staged.

| Grupo | Total | Tracked | Untracked | Principais caminhos | Risco de conflito futuro |
| --- | ---: | ---: | ---: | --- | --- |
| Código de produção | 17 | 12 modificados | 5 | `App.js`, navegação, `MapScreen`, diagnostics/Sentry, task, finalização e fila | **alto**: 16 também são tocados pelo remoto e cinco divergem do blob remoto final |
| Testes | 12 | 4 modificados | 8 | diagnostics, Sentry, active-run lifecycle/runtime, finalização e fila | **alto**: contratos WIP exercitam runtime alterado remotamente |
| Docs | 40 | 9 modificados | 31 | fontes, padrões, decisões, bugs, `docs/product`, `docs/architecture`, auditorias | **alto**: 33 sobreposições, 19 com conteúdo divergente |
| Harness/IA | 2 | 1 modificado | 1 | `docs/14-instrucoes-para-ia.md`, `AGENTS.md` mobile | **alto**: ambos divergem das versões remotas |
| Configs/build | 11 | 6 modificados | 5 | `.env.example`, `.gitignore`, `.nvmrc`, `eas.json`, `package.json`, plugins/scripts | **alto**: todos são tocados pelo remoto; `package.json` diverge |
| Generated/cache | 5 | 0 | 5 | `.obsidian/*.json` | baixo para merge; alto se forem confundidos com fonte versionável |
| Android/native | 0 | 0 | 0 | nenhuma alteração local pré-existente nessa categoria | remoto altera `RunNotificationForegroundService.kt` |
| Desconhecido | 2 | 2 deletados | 0 | dois PDFs sob `scripts/` | médio; Git prova a deleção, não sua autoria ou intenção |
| **Total** | **89** | **34** | **55** | 32 modificados + 2 deletados + 55 não rastreados | — |

Comparando os 89 caminhos locais aos 118 remotos:

- 71 caminhos se sobrepõem;
- 40 estão alinhados ao estado remoto: 38 têm o mesmo object hash após os
  filtros Git e dois são deleções coincidentes;
- 31 se sobrepõem, mas têm conteúdo divergente;
- 18 mudanças locais não são tocadas pelo intervalo remoto.

Os 31 overlaps divergentes incluem `App.js`, `MapScreen.js`, `package.json`,
`AGENTS.md`, `docs/14-instrucoes-para-ia.md`, `activeRunState.test.js`, serviços
e testes de finalização/fila, além de docs de produto e arquitetura. Não há
evidência Git para atribuir autoria humana ou automatizada a qualquer mudança;
nenhuma atribuição foi inferida.

### 13.4 Harness provenance

`tracked?` abaixo sempre se refere ao Git que poderia conter o recurso no seu
caminho atual; cache instalado ou arquivo em `.git/` não conta como source
versionado.

| Recurso | Caminho atual | Escopo | Tracked? | Origem observável | Candidato a fonte canônica? |
| --- | --- | --- | --- | --- | --- |
| Master `AGENTS.md` | `/home/eduardo/Wayper/AGENTS.md` | workspace compartilhado | não; root sem Git | filesystem do workspace | **sim**, depois de receber ownership Git explícito |
| Mobile `AGENTS.md` | `wayper/AGENTS.md` | projeto mobile | untracked local; tracked em `origin/develop` | conteúdo local divergente + commit remoto `bef386b` | **sim**, após reconciliação |
| `AGENTS.override.md` | inexistente | — | — | — | não criar sem caso concreto |
| Root `.agents` | `/home/eduardo/Wayper/.agents/skills/` | workspace | não | nove skills locais | **sim** para skills Wayper, sob Git explícito |
| Skills Wayper | `wayper-brain`, active-run, mobile-shell, persistence-sync, territory-map, duas skills do site | workspace | não | arquivos locais de skill | **sim**, separadas por ownership mobile/site/shared |
| Caveman local | `.agents/skills/caveman/` | workspace, mas genérico | não | também há instalação global | não como regra Wayper; consolidar no escopo global |
| Root `.codex` | `/home/eduardo/Wayper/.codex/` | workspace | não | config, agents, hook, maps e benchmarks locais | **sim** apenas para source/config; não para derivados |
| Custom agents | `.codex/agents/README.md` + 15 TOMLs | workspace | não | perfis locais e política de precedência | **sim**, com owner versionado |
| Config Codex de projeto | `.codex/config.toml` | workspace | não | habilita agents, limite seis e profundidade um | **sim**, project-scoped |
| Adapter RTK | `.codex/hooks/rtk-codex.js` | workspace | não | implementação chamada pelo hook global | **sim**, acompanhado de bootstrap/check |
| Mapas | `.codex/maps/` | workspace | não | mapas marcados parcialmente stale | não como autoridade; **GENERATED** |
| Benchmarks | `.codex/benchmarks/` | workspace | não | evidência histórica de tuning | versionável como evidência, nunca runtime canônico |
| Docs compartilhados do Harness | `/home/eduardo/Wayper/docs/ai/` | workspace | não | `PROJECT_MAP`, `DEVELOPMENT`, `DOCUMENTATION_STATUS` | **sim**, sob o mesmo owner do Master |
| Config global Codex | `/home/eduardo/.codex/config.toml` | usuário/global | fora do projeto | modelo, plugins e estado global | só para preferências genéricas; não para regras Wayper |
| Registro global de hooks | `/home/eduardo/.codex/hooks.json` | usuário/runtime | fora do projeto | `PreToolUse/Bash` aponta para o adapter RTK do workspace | não; deve ser estado instalado a partir de source versionado |
| Política RTK global | `/home/eduardo/.codex/RTK.md` | usuário/global | fora do projeto | política genérica | sim para RTK genérico |
| Resumo RTK local | `/home/eduardo/Wayper/RTK.md` | workspace | não | resumo local da política global | não isoladamente; deve derivar da fonte normativa |
| Binário RTK | `/home/eduardo/.local/bin/rtk` | usuário/runtime | fora do projeto | instalação executável local | não; dependência externa/bootstrap |
| Graphify ignore | `/home/eduardo/Wayper/.graphifyignore` | workspace | não | exclusões locais, inclusive Harness e corpus adversarial | **sim** como configuração project-scoped |
| Graphify output | `/home/eduardo/Wayper/graphify-out/` | runtime/cache | não | grafo, manifest, relatórios, snapshots, memória e cache gerados | não; **GENERATED**, e stale para o working tree atual |
| Graphify Git hooks | `wayper/.git/hooks/post-commit` e `post-checkout` | runtime local do Git mobile | não versionável pelo index | instalados por `graphify hook install`, executáveis e com paths absolutos | não; cópias instaladas, source deve ser bootstrap versionado |
| Skill lock | `/home/eduardo/Wayper/skills-lock.json` | workspace | não | pin/hash somente de Caveman | candidato apenas se o owner do Harness definir política de lock |
| Diretórios mobile vazios | `wayper/.agents/`, `wayper/.codex/` | mobile | não; Git não rastreia diretório vazio | sem arquivos ou função observada | não; **DEPRECATE** se continuarem sem consumidor |
| Instrução detalhada | `wayper/docs/14-instrucoes-para-ia.md` | mobile | sim, modificada | source histórico local + remoto | **sim** como protocolo detalhado, não como router |
| Prompts históricos | `wayper/docs/wayper/11-prompts-para-ia.md` | mobile | sim | legado Codex/Claude/GPT | não; **DEPRECATE** após migrar conteúdo único |
| Backlog/exemplos IA | `wayper/docs/20-backlog-ia.md`, `docs/21-exemplos-de-comandos-ia.md` | mobile | sim | guias humanos | sim como documentação, não como regra permanente |
| Auditoria do Harness | este arquivo | mobile | untracked | Unidade 1/1.5 | **sim**, depois de reconciliar e versionar conscientemente |
| Plugins/skills globais | caches/instalações sob `/home/eduardo/.codex` e `/home/eduardo/.agents` | usuário/global/runtime | fora do projeto | Ponytail, Superpowers, Caveman e outros pacotes instalados | somente os genéricos; cache nunca é fonte canônica Wayper |

Não foi encontrado script versionado que instale ou valide o conjunto de hooks
RTK/Graphify. Os hooks ativos, portanto, comprovam o runtime desta máquina, não
a reprodutibilidade do projeto em um clone novo.

`git check-ignore` não classificou nenhum candidato mobile do Harness como
ignorado: `AGENTS.md` e esta auditoria são untracked não ignorados; `.agents/`
e `.codex/` estão vazios, também não ignorados. Os hooks dentro de `.git/` são
metadata local fora do worktree, não arquivos ignorados.

### 13.5 Não duplicação e destino das sobreposições

| Sobreposição | Classificação | Resolução proposta, ainda não executada |
| --- | --- | --- |
| Root `AGENTS.md` x mobile `AGENTS.md` | **KEEP + MERGE** | manter dois routers por escopo; retirar duplicação genérica e deixar regras mobile somente no nearest file |
| Root `AGENTS.md` x `wayper-brain` | **KEEP + MERGE** | AGENTS governa invariantes; Brain conserva a decisão operacional de roteamento/orçamento; uma regra não deve ser mantida em duas versões |
| `wayper-brain` x nove skills de domínio/processo | **KEEP** | Brain seleciona; skills carregam procedimento bounded. Não criar segundo context router |
| Caveman do workspace x Caveman global | **MOVE/DEPRECATE** | manter a capacidade genérica no escopo global; remover a cópia project-scoped somente após provar que lock/bootstrap não depende dela |
| Skill Graphify x `.graphifyignore` x hooks x docs | **KEEP/MOVE** | manter a skill e a configuração; versionar bootstrap; tratar hooks instalados como runtime |
| `graphify-out` x `.codex/maps` | **GENERATED** | ambos são mapas derivados e possivelmente stale; nunca decidir arquitetura por eles sem source verification |
| Quatro skills mobile x mobile `AGENTS.md`/docs 14 | **KEEP + MERGE** | skills guardam playbooks de domínio; router/docs guardam invariantes e fontes, sem copiar passos inteiros |
| Duas skills do site x Master | **MOVE** | ownership deve ficar no Git do site ou no shared Harness versionado, nunca no mobile por acidente |
| Mapper x Graphify/maps | **KEEP** | profile define responsabilidade; Graphify/maps são ferramenta e cache, não um segundo agente |
| Researcher x Mapper | **KEEP** | externo/primário versus source local; fronteira já é distinta |
| Debugger x Tester | **KEEP** | diagnóstico de causa raiz versus execução/isolamento de checks |
| Architect x Adjudicator | **KEEP** | decisão de design versus arbitragem excepcional de evidência de alto risco |
| Implementer x demais agents | **KEEP** | único writer; não há outro perfil com ownership de edição concorrente |
| Reviewer/final reviewer x sete reviewers especializados | **KEEP** | seleção por risco evita executar todos; não há duplicação factual enquanto o Brain mantém dispatch mínimo |
| `.codex/config.toml` x config global | **KEEP** | projeto define agents/limites; usuário define modelo/plugins genéricos. Regra Wayper não deve ficar global |
| `hooks.json` global x adapter RTK x Git hooks Graphify | **MOVE** | são registro, implementação e cópias instaladas; criar no futuro um bootstrap/check project-scoped, não mais hooks paralelos |
| `RTK.md` global x resumo local | **MERGE** | uma fonte normativa genérica e um ponteiro/resumo curto, sem duas políticas independentes |
| AGENTS x docs 14 | **KEEP + MERGE** | AGENTS curto como router; docs 14 contém detalhes operacionais carregados sob demanda |
| docs 14 x prompt histórico/docs 20 | **DEPRECATE** | migrar somente conteúdo ainda único; backlog continua humano, não instrução de runtime |

Os quinze agents foram avaliados por pares de responsabilidade acima. Não há
evidência suficiente para apagar ou fundir perfis nesta unidade; adjacency de
papel não prova duplicação. A Unidade 2 só deve consolidar perfis mediante
callers, uso ou findings concretos.

### 13.6 Resolução do baseline Jest

Foram reexecutados isoladamente os dois testes decisivos, ambos com o comando
canônico `npm test -- <arquivo> --runInBand`. Nenhum arquivo foi alterado pelos
checks.

| Falha | Causa raiz e evidência | Correção disponível? | Existe no remoto? | Blocker? |
| --- | --- | --- | --- | --- |
| `activeRunLifecycleContract.test.js` | o teste não rastreado importa `activeRunTrackingService.js`; esse serviço faz import top-level de `expo-task-manager`. Com `jest.transform = {}`, Node chega a `node_modules/expo-task-manager/build/TaskManager.js:1` e emite literalmente `SyntaxError: Cannot use import statement outside a module`. É uma dependência indevida do contrato testado no source local, não prova de que Jest deva transformar todo o Expo | sim: separar o registro headless do serviço importável, sem ampliar transform global | **sim**. `ac802b3` remove o import do serviço e cria `src/tasks/activeRunLocationTask.js`; o teste em si não existe no remoto | não para a arquitetura remota; é blocker do checkout local até reconciliação e nova execução |
| `activeRunRuntimeService.test.js:161` | o teste não rastreado chama `runtimeService.__resetActiveRunRecoveryRuntimeForTests()`, que não existe. O erro literal é `TypeError: runtimeService.__resetActiveRunRecoveryRuntimeForTests is not a function`; os 33 casos falham no mesmo `beforeEach`. Remover a chamada não isola `reconcileInFlight`, `lastKnownActiveSnapshot`, deep-link, notification action e reconcile reason | há desenho mínimo possível — reset explícito de estado de módulo ou isolamento real por módulo —, mas o contrato pretendido ainda precisa ser decidido e validado | **não**. O símbolo está ausente no working tree, HEAD e `origin/develop`; o remoto só altera propagação de `userId` nesse serviço | **sim** para um baseline Jest verde; correção deve ficar em unidade separada após reconciliar a base |

Classificação da primeira falha: consequência da arquitetura local superada pelos
commits remotos, não incompatibilidade que justifique alterar Jest. Classificação
da segunda: teste WIP incompleto em relação ao módulo observado; não há evidência
de export removido/renomeado, pois ele nunca aparece em HEAD ou remoto. Nenhuma
correção foi aplicada: a primeira já tem solução remota; a segunda exigiria uma
decisão de contrato e tocaria um módulo de produção ou o isolamento ESM do teste.

### 13.7 Canonical Harness recommendation

**Root recomendado:** `/home/eduardo/Wayper`, mas somente depois de receber
ownership Git explícito como um pequeno repositório de workspace/Harness. Hoje
ele é root operacional, não fonte canônica confiável. Esse repositório deverá
ignorar integralmente os dois Git roots filhos e todo output/cache. Criá-lo ou
ligá-lo a um remote exige decisão humana e fica fora desta unidade.

A separação proposta é:

| Escopo futuro | Deve conter | Não deve conter |
| --- | --- | --- |
| Shared project-scoped, Git-owned no workspace | Master `AGENTS.md`, `wayper-brain`, Graphify skill/config, custom agents compartilhados, `.codex/config.toml`, source/bootstrap dos hooks, `docs/ai`, lock declarativo e scripts auxiliares mínimos | `graphify-out`, plugin cache, credenciais, configuração de modelo pessoal, hooks já instalados em `.git/`/home |
| Mobile project-scoped, no Git `wayper/` | mobile `AGENTS.md`, quatro skills mobile se não forem shared, docs 14 e docs/ADRs/auditorias mobile | skills do site, configuração global, cópias manuais do Master |
| Site project-scoped, no Git `wayper-site/` | regras e duas skills específicas do site | runtime mobile e docs de corrida |
| Global/user-scoped | modelo/preferências pessoais, RTK genérico, plugins genéricos e seus instaladores | qualquer regra, agent, path absoluto ou decisão específica da Wayper |
| Runtime/cache/generated | `graphify-out`, `.codex/maps` gerados, plugin caches, logs e hooks instalados | qualquer fonte de verdade ou configuração que precise viajar no clone |

Se um terceiro Git root de workspace não for aprovado, deve-se escolher **um**
dos repositórios existentes como owner do source compartilhado e gerar/instalar
as projeções do root. Manter os mesmos arquivos manualmente em dois repos ou no
home não é uma alternativa canônica.

### 13.8 Decisão sobre sincronizar `develop`

**Recomendação: `NOT_SAFE_TO_SYNC`.**

O remoto é linear e não há commits locais exclusivos, o que simplifica o
histórico, mas não torna o working tree seguro para um pull. Há 89 mudanças
pré-existentes, 71 paths compartilhados com o intervalo remoto e 31 conteúdos
divergentes. Os overlaps incluem runtime crítico, package/config, testes,
`AGENTS.md` e docs canônicas. Arquivos untracked também podem colidir com paths
que o remoto passa a rastrear. Um `git pull` agora pode recusar a operação,
sobrescrever a compreensão do WIP ou exigir uma resolução ampla sem procedência.

A sincronização só se torna segura após inventariar/preservar explicitamente o
WIP, decidir por path qual versão é intencional e escolher uma estratégia de
integração autorizada. Nenhuma dessas ações foi executada nesta unidade.

### 13.9 Prontidão exata para a Unidade 2

A Unidade 2 pode começar somente quando estes pontos estiverem resolvidos:

1. decisão humana sobre o owner Git/remote do Harness compartilhado no workspace;
2. decisão de base: reconciliar primeiro com `origin/develop` ou trabalhar
   conscientemente sobre o WIP local composto;
3. preservação verificável das 89 mudanças e plano explícito para os 31 overlaps
   divergentes, sem stash/commit/sync automático;
4. reconciliação do `AGENTS.md` mobile e `docs/14` com as versões remotas;
5. confirmação de que Graphify, maps e caches permanecerão derivados e fora da
   fonte canônica;
6. escolha documentada de quais recursos são shared, mobile, site e global;
7. decisão separada para o contrato de reset do runtime test e reexecução dos
   dois testes após a base escolhida;
8. autorização específica antes de qualquer criação de Git root, movimento,
   remoção, instalação de hook ou sincronização.

Até lá, é seguro apenas continuar com discovery/read-only. Não está pronto para
consolidar/mover o Harness nem para sincronizar `develop`.

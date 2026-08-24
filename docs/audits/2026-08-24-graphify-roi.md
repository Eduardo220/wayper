# Graphify ROI — Unidade 17

> **Data:** 2026-08-24<br>
> **Decisão:** `RECONFIGURE`<br>
> **Escopo:** Wayper mobile AI Harness; nenhum source funcional do app

## Resultado

Graphify não paga o custo como índice shared sempre ativo. Ele permanece apenas
como ferramenta local, app-only e sob demanda para `path`, `explain` e
`affected` quando o mapa é realmente amplo. `rg`, source, testes e os checkers
do projeto continuam owners. Hooks Git foram removidos; memória Graphify não é
promovida.

## Identidade e proveniência

- executável: `/home/eduardo/.local/bin/graphify`;
- runtime real: uv tool `graphifyy 0.9.38`, Python 3.14 isolado;
- pacote: `graphify/__init__.py` no ambiente uv;
- upstream/tag: `Graphify-Labs/graphify`, `v0.9.38`, commit
  `10ad921b423b767dd8a947bbf0fbcc2e95038ad3`;
- instalação estava nove releases atrás de `v0.9.47` na data da auditoria;
- licença instalada: Apache-2.0, com porções MIT preservadas; `NOTICE` identifica
  Safi Shamsi e contribuidores;
- skill global e pacote declaravam `0.9.38`; não havia adapter próprio Wayper.

## Integração encontrada

O índice canônico apontava para `/home/eduardo/Wayper`, não para este app.
Baseline antes dos testes: 7.144 nodes, 15.386 edges, 982 entradas de manifest e
66.898.904 B no diretório. Seis snapshots datados respondiam pela maior parte do
disco. Só 4.321/7.144 nodes (60,5%) pertenciam ao mobile; backup do site,
debug-bisect, site live e backups internos apareciam no mesmo grafo.

O graph era undirected e tinha 14.584 edges `EXTRACTED` e 802 `INFERRED`.
Memória existente tinha três respostas; duas estavam corrigidas e uma útil. A
reflexão já avisava que o antigo path finalization→queue era co-dependência
estrutural, não prova de fluxo. Nenhum resultado desta unidade foi salvo.

## Segurança, privacidade e rede

AST, build e query code-only são locais. Query logging é opt-in; estava
desligado. O `cost.json` registrava zero input/output tokens mensurados.
Extração semântica suporta Anthropic, OpenAI, Gemini, Kimi, DeepSeek, Azure e
Ollama e pode enviar source/chunks quando explicitamente selecionada. Por isso o
default Wayper é `--code-only`; backend remoto exige autorização e data review.

O detector exclui dotenv, chaves/certificados, credential stores e nomes
sensíveis, e a `.graphifyignore` shared também excluía `.env*`, service accounts
e mídia. Isso reduz risco, mas heurística/ignore não é DLP nem autorização para
upload. Artifacts eram owner-only para escrita e world-readable pela umask
local (`0644` files, `0755` dirs).

## Cobertura relevante

| Corpus mobile | Suporte observado | Limite |
| --- | --- | --- |
| 255 `.js`/JSX | `FULL` sintático para arquivos, symbols, static imports e muitas calls | `PARTIAL` semântico para callbacks, receivers, aliases e strings |
| 7 `.kt` | `FULL` AST de classes/functions/imports/calls | `PARTIAL` para Expo/native registration e runtime dispatch |
| 3 `.gradle` | parser Groovy/Gradle presente | `PARTIAL`; configuração não equivale a build behavior |
| 17 `.json` | manifests/configs reconhecidos | `PARTIAL`; 17 files do cold geraram zero nodes/retry |
| 1 `.xml` | não classificado | `NONE` para `AndroidManifest.xml` nesta versão |

React Navigation, event listeners, Expo TaskManager, dynamic imports e
NativeModules são estáticos apenas quando a sintaxe revela uma edge resolvível.
No fluxo deferred, o graph encontrou o import dinâmico do módulo mas não a call
`sync.syncRunsToFirestore?.()`. Proximidade nunca prova ordem, lifecycle,
idempotência nem boundary nativa.

## Método

Cada caso começou em `WITHOUT_GRAPH` com `rg`, ranges, owners e testes. O
`WITH_GRAPH` usou o mesmo target, primeiro no graph shared e depois no candidato
app-only. Tempos vêm de `/usr/bin/time`; RSS é peak. Bytes são stdout ou artifact
real. Proxy de tokens é `bytes/4` apenas para comparação, nunca billing.
Precisão/recall são contra o working set confirmado no source, não contra labels
do próprio graph.

## G1–G8

| Caso | WITHOUT_GRAPH | WITH_GRAPH | Precisão/recall e decisão |
| --- | --- | --- | --- |
| G1 feed interaction | `rg`: 0,00 s, 7,7 MB, 122 B; achou o único consumer | shared `explain`: 0,65 s, 75,8 MB, 1.758 B | exact explain correto, mas não evitou confirmação; `NO_GRAPH` |
| G2 ranking→XP/profile | `rg`: 0,00 s, 7,7 MB, 5.737 B | app-only `path`: 0,48 s, 64,5 MB, 195 B | 3/3 imports, alta precisão; ganho material de contexto (~49 tokens proxy); opcional |
| G3 save→queue→Firestore | `rg`: 0,00 s, 7,7 MB, 7.225 B | app-only broad query: 0,50 s, 69,7 MB, ~1.400-token cap | saída desviou para territory/scripts e omitiu call dinâmica; recall insuficiente; `NO_GRAPH` como prova |
| G4 recovery/lifecycle | `rg`: 0,00 s, 7,7 MB, 14.620 B | shared broad query: 0,76 s, 81,5 MB, 5.276 B; `explain` foi melhor | imports úteis, wiring/task/native incompleto; zero files seguros evitados; só discovery opcional |
| G5 MapScreen impact | `rg`: 0,00 s, 7,2 MB, 2 linhas | app-only `explain` 0,40 s/61 MB + `affected` 0,25 s/55 MB | ambos acharam `MainNavigator`; graph agrupou imports mas gerou mais output; opcional apenas se mapa amplo |
| G6 architecture boundaries | checker: 2,50 s, 204 MB, 8.810 B, allowlist/ratchet/regressions | `explain firebase/firestore`: 0,40 s, 60 MB, viu só 1 import dinâmico de teste | recall materialmente falso; graph não implementa policy; `NO_GRAPH` |
| G7 copy trivial | `rg`: 0,00 s, 7,7 MB, 155 B, 2 matches | zero build/query | 100% do alvo; `NO_GRAPH` obrigatório |
| G8 hotspot | `rg`: 0,00 s, 7,4 MB, 2.490 B | app-only `explain` 0,40 s/61 MB + `affected` 0,25 s/55 MB | inventário útil; size/source/testes ainda decidem; opcional |

G2 reduz output de 5.737 B para 195 B quando os endpoints já são conhecidos.
Nos demais casos o custo fixo, falsos positivos ou necessidade de source anulam
a economia. G6 é o contraexemplo decisivo: o checker nativo conhece boundary,
legado, allowlist e ratchet; o graph não.

## Custos operacionais

| Operação | Shared | Candidato app-only |
| --- | ---: | ---: |
| cold code-only/no-cluster | 15,08 s; 329 MB; 734 files; 5.564 nodes | 7,34 s; 262 MB; 309 files; 3.757 nodes |
| artifact | 66.898.904 B com snapshots/cache/report | 5.502.553 B raw |
| warm `explain MapScreen`, p50/5 | 0,64 s; ~74 MB | 0,41 s; ~61 MB |
| refresh sem mudança | full hook 16,82 s; 364 MB; 715 uncached | 2,85 s; 78 MB; 17 zero-node retries |
| commit de 6 files | 0,05 s foreground + 10,46 s/176 MB background | não aplicável após reconfiguração |
| checkout/branch | 0,06 s foreground + 16,82 s/364 MB background | rebuild só quando selecionado |

Os hooks eram detached/fail-open: Git voltava rápido, mas CPU/RAM continuavam.
O log mostrou queue por rebuild concorrente, retry constante de JSON zero-node,
churn de 417–442 communities e graph com 7.307–7.308 nodes em execuções próximas.
O custo não estava no foreground; estava deslocado e pouco visível.

## Staleness e Git

Fixture controlada provou:

1. graph inicial representou `HEAD`;
2. após `MODIFIED`, `STAGED` e arquivo `UNTRACKED`, query sem refresh não viu os
   novos symbols;
3. refresh incremental viu staged e untracked igualmente, pois lê filesystem;
4. stage não cria snapshot/semântica própria;
5. sem hooks, branch switch mantém cache stale até rebuild explícito.

No graph clustered shared, `built_at_commit` igualava o HEAD inicial. Essa marca
não prova working tree limpa nem que cada node veio daquele commit. Antes de uma
claim material, refresh + source atual são necessários.

## Seleção do próximo debt slice

Candidates por size/complexity foram `MapScreen`, `activeRunTrackingService`,
`sync.js`, `DiagnosticsScreen` e `RunDetailScreen`. Os três primeiros têm maior
dívida bruta, mas também controlam corrida, local-first ou sync e exigem safety
mais cara. `DiagnosticsScreen` é o melhor primeiro candidato: HIGH no baseline,
829 linhas significativas, função de 514 linhas, complexidade 156, consumer
único em `MainNavigator`, services e testes diagnósticos já identificados.

Working set provável: `DiagnosticsScreen`, `MainNavigator`,
`runDiagnosticsService`, `localDiagnosticsService`, export/upload/preferences e
seus testes. Invariantes: redaction/privacidade, export sem credenciais,
diagnóstico fail-open e zero impacto na corrida. O slice não foi implementado;
essa é tarefa real seguinte, fora da Unidade 17.

## Decisão e rollback

`RECONFIGURE`:

- remover `post-commit` e `post-checkout` Graphify;
- reter binário/skill user-global;
- gerar graph app-only, code-only e no-cluster somente quando selecionado;
- preferir `rg`; usar `path`/`explain`/`affected`, não query ampla, quando houver
  ganho previsto;
- confirmar toda edge material no source/teste;
- não promover graph memory nem enviar source a backend remoto por default.

Rollback operacional: `graphify hook install` restaura os hooks, mas só deve ser
feito se novas medições mostrarem ganho recorrente superior aos 10–17 s de
background e às falhas de precisão. Rollback documental é reverter esta unidade;
nenhum dado funcional exige migração.

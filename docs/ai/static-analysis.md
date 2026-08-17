# Static Analysis Foundation — Wayper mobile

> **Status:** vigente  
> **Escopo:** JavaScript do app, testes, scripts e configuração  
> **Owner:** [`eslint.config.js`](../../eslint.config.js)  
> **Baseline:** 2026-08-17, parent HEAD `ee389aa`

## Decisão

O comando canônico é `npm run lint`. Ele executa `eslint .` com Flat Config e a
base oficial `eslint-config-expo`. O CLI direto foi escolhido porque `expo lint`
limitou a execução observada a `src/`, omitindo entrypoints e scripts; a
documentação oficial permite ESLint direto quando há customização. A fundação
mede correção estática; formatting, budgets de tamanho/complexidade e boundaries
arquiteturais continuam fora do config.

Stack observada:

| Item | Versão / decisão |
| --- | --- |
| Expo | `54.0.36` (SDK 54) |
| React Native / React | `0.81.5` / `19.1.0` |
| Node / npm da captura | `22.23.2` / `10.9.8` |
| ESLint | `9.39.5` |
| `eslint-config-expo` | `10.0.0` |
| `globals` | `16.5.0`, apenas para overrides Node/Jest |
| Typecheck | não canônico; o projeto é JavaScript |

O SDK 54 suporta Flat Config. `globals` é dependência direta porque o config a
importa; a versão segue a major já usada por `eslint-config-expo`.

## Escopo e ambientes

O lint parte de `.` e alcança `App.js`, `index.js`, `googleAuth.js`, `src/`,
`scripts/`, `plugins/`, `metro.config.js` e o próprio config. A base Expo trata o
runtime React/React Native e Metro; overrides restritos fornecem:

- globals Node somente a `scripts/**/*` e `plugins/**/*`;
- globals Jest somente a `__tests__` e arquivos `*.test`/`*.spec`;
- nenhum global de Node/Jest é liberado universalmente no app.

Ignores explícitos: `.expo`, builds Android, `build`, `coverage`, `dist`,
`graphify-out`, `node_modules` e `web-build`. Source real não é ignorado.

Não há `lint:fix`: autofix da base inteira não faz parte do workflow. Se uma
correção isolada justificar `--fix`, revise o diff e rode validação direcionada.

## Política de severidade

- **ERROR:** código inválido ou sinal altamente confiável, como nome indefinido,
  export/import inválido não legado, unreachable, assignment inválido, perda de
  precisão, chaves/cases duplicados, `use-isnan`, `valid-typeof` e regras Expo
  de acesso a env.
- **WARN:** dívida real ou heurística que ainda precisa de burn-down, incluindo
  unused, imports, hooks, condição constante e duplicate export já existente.
- **OFF/não adicionado:** formatting, `no-console`, budgets, complexity,
  max-lines e architecture boundaries. Eles não são falsamente chamados de gate.

`react-hooks/rules-of-hooks` e `import/export` seriam sinais de error em código
novo, mas existem 6 e 4 ocorrências legadas respectivamente. Nesta fundação elas
ficam como warning explícito; desligá-las esconderia dívida e corrigi-las mudaria
produção fora do escopo. O burn-down deve removê-las antes de promover severidade.

## Lint baseline

A primeira execução da base Expo, antes dos overrides/severidades finais, leu
265 arquivos e encontrou `71 errors / 183 warnings`:

- 61 `no-undef` eram configuração de ambiente (`describe`/`test`/`expect` e
  `__dirname`); os overrides corrigiram a causa;
- 6 `react-hooks/rules-of-hooks` e 4 `import/export` eram dívida existente;
- nenhum source foi alterado para fabricar baseline verde.

A configuração final lê 265 arquivos, encontra 60 arquivos com findings e
termina com `0 errors / 206 warnings`.

| Rule | Warnings | Classe |
| --- | ---: | --- |
| `import/no-named-as-default-member` | 86 | legacy/import signal |
| `no-unused-vars` | 53 | legacy debt |
| `import/no-named-as-default` | 24 | legacy/import signal |
| `react-hooks/exhaustive-deps` | 9 | safety invariant gradual |
| `import/no-duplicates` | 8 | safety/maintenance |
| `no-constant-binary-expression` | 8 | provável bug; investigar por owner |
| `react-hooks/rules-of-hooks` | 6 | real bug signal; prioridade de burn-down |
| `no-constant-condition` | 5 | feature-toggle/legacy debt a confirmar |
| `import/export` | 4 | duplicate export debt |
| unused disable directive | 3 | cleanup seguro futuro |

Distribuição: `src/` tem 202 warnings; arquivos raiz, 4; scripts e plugins, zero.
Os maiores concentradores são:

| Arquivo | Warnings |
| --- | ---: |
| `src/screens/MapScreen.js` | 45 |
| `src/screens/Runs/RunDetailScreen.js` | 23 |
| `src/services/runTracking/activeRunRuntimeService.js` | 12 |
| `src/utils/sync.js` | 9 |
| `src/services/run/runAutoSaveService.js` | 8 |
| `src/screens/Runs/ZoneDetailScreen.js` | 7 |
| `src/screens/Runs/DashboardScreen.js` | 6 |

Warnings não bloqueiam ainda e o comando não usa `--max-warnings`. Esta contagem
é uma fotografia para burn-down, não autorização para ignorar warning novo.

## File-size baseline

A captura usa linhas físicas e separa testes/fixtures do source de produção.
Nenhuma regra `max-lines` está ativa.

| Categoria | Arquivos | Linhas | >350 | >500 | >750 | >1000 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| produção JS | 192 | 71.285 | 57 | 44 | 25 | 12 |
| testes/fixtures JS | 57 | 16.671 | 16 | 9 | 2 | 2 |
| scripts/plugins Node | 14 | 1.835 | 0 | 0 | 0 | 0 |
| configs JS | 2 | 54 | 0 | 0 | 0 | 0 |
| native versionado | 8 | 810 | — | — | — | — |
| generated versionado | 0 | 0 | — | — | — | — |

Top 25 de produção e responsabilidades aproximadas:

| Arquivo | Linhas | Responsabilidades observadas |
| --- | ---: | --- |
| `src/screens/MapScreen.js` | 7.199 | UI/mapa, integração do runtime, lifecycle, finish e deferred work |
| `src/services/runTracking/activeRunTrackingService.js` | 4.995 | tracking foreground/background, snapshots, persistência e bridge nativa |
| `src/utils/sync.js` | 2.363 | normalização local, payloads e sincronização Firestore |
| `src/screens/Runs/RunDetailScreen.js` | 1.566 | detalhe, edição, remoção, export e share de corrida |
| `src/services/run/runDeferredTaskQueueService.js` | 1.553 | enqueue, retry/replay e processamento pós-save |
| `src/screens/ProfileScreen.js` | 1.468 | perfil, estatísticas, conquistas e share |
| `src/components/Map/WayperMapLibre.js` | 1.444 | layers, camera, gestures e adaptação MapLibre |
| `src/screens/HomeScreen.js` | 1.436 | dashboard, feed social e resumos |
| `src/services/runTracking/activeRunState.js` | 1.296 | schema, normalize/merge, métricas e render paths do snapshot |
| `src/services/territory/territoryGeometryService.js` | 1.089 | normalização e operações de geometria territorial |
| `src/screens/Friends/FriendsScreen.js` | 1.083 | lista, busca, pedidos e presença de amigos |
| `src/screens/RankingScreen.js` | 1.059 | filtros, consultas e apresentação de ranking |
| `src/services/tracking/trackingPathService.js` | 987 | sessão de tracking, filtros, caminho e métricas |
| `src/screens/Group/GroupsScreen.js` | 944 | listar, criar e entrar em grupos |
| `src/components/Home/ActivityFeedCard.js` | 920 | render e interações de atividade no feed |
| `src/components/Runs/RunSummaryModal.js` | 894 | resumo pós-corrida e ações de share |
| `src/screens/DiagnosticsScreen.js` | 873 | preferências, filas, export e upload de diagnósticos |
| `src/services/monitoring/sentryService.js` | 853 | inicialização, captura, contexto e performance Sentry |
| `src/services/run/runRecoveryService.js` | 833 | detectar, carregar e resolver recovery local |
| `src/screens/Runs/DashboardScreen.js` | 813 | histórico, métricas, sync e territórios da corrida |
| `src/services/territory/territoryStorageService.js` | 806 | serialização e persistência local de território |
| `src/services/feed/feedService.js` | 771 | feed local/remoto, normalização e cache |
| `src/services/run/runNotificationService.js` | 760 | registro, estado e actions da notificação de corrida |
| `src/services/diagnostics/localDiagnosticsService.js` | 752 | armazenamento, leitura e export local de eventos |
| `src/services/runService.js` | 752 | serviço legado de corrida e persistência compatível |

## Complexity baseline experimental

As regras core foram executadas apenas como sonda sobre produção, com limite
mínimo para enumerar valores. Elas não fazem parte do config final e os valores
abaixo não são thresholds aprovados.

| Medida | P50 | P90 | P95 | P99 | Máximo |
| --- | ---: | ---: | ---: | ---: | ---: |
| complexidade ciclomática | 3 | 13 | 20 | 48 | 198 |
| linhas por função | 9 | 38 | 58 | 198 | 5.148 |
| statements por função | 4 | 14 | 21 | 42 | 262 |
| profundidade observada | 1 | 2 | 3 | 4 | 5 |
| parâmetros por função | 1 | 2 | 3 | 4 | 6 |

Sondas de distribuição: 521 funções ficaram acima de complexidade 10, 201 acima
de 20 e 34 acima de 50; 186 ficaram acima de 50 linhas, 71 acima de 100 e 11
acima de 350. O maior hotspot é `MapScreen` (complexidade 198 e função de 5.148
linhas). `DiagnosticsScreen`, `sync.js`, `activeRunState` e
`activeRunRuntimeService` também aparecem no topo. A Unidade 7 deve escolher
ratchets pela distribuição, sem exigir 350 linhas de todo legado de uma vez.

## Sinais medidos, ainda sem enforcement

- `import/no-cycle` encontrou 31 arestas em ciclos; diagnostics, repositories,
  sync e runtime concentram os caminhos. Não foi ativado sem mapa de ownership.
- Existem 161 usos de `console.*`: 99 em produção e 62 em scripts. Scripts têm
  uso legítimo; produção precisa primeiro confirmar o logger owner.
- Existem 11 imports relativos com três níveis; a maioria é asset/test fixture.
- Há acesso Firestore direto em telas/componentes sociais. Boundaries serão
  tratados numa unidade própria, não por disable/allowlist improvisada.
- Nenhum plugin de boundaries ou ferramenta de ciclo adicional foi instalado.

## Typecheck e baseline machine-readable

`IS_TYPESCRIPT_PROJECT=NO` e `TYPECHECK_CANONICAL=NO`: há 254 arquivos `.js`, 10
`.cjs`, zero `.ts`/`.tsx`, nenhum `tsconfig`, `checkJs`, Flow ou estratégia JSDoc
de tipos. Pacotes Babel/TypeScript transitivos não tornam o app TypeScript.

Não foi criado JSON de baseline. Sem um consumer/ratchet, ele duplicaria esta
fotografia e ficaria stale. A Unidade 7 pode introduzir um artefato gerado quando
houver budget executável que o consuma.

## Saúde externa observada

`npx expo-doctor` passou 18/18 checks e `npx expo config --type public` resolveu
o manifest. `npm audit --json` reportou 46 advisories (1 low, 22 moderate, 22
high e 1 critical); remediation de dependencies é dívida fora deste setup.
Nenhum `npm audit fix` ou upgrade forçado foi executado.

## Próximos gates

CI futuro deve executar o mesmo `npm run lint`; CI não foi alterado aqui. A ordem
segura é: burn-down dos bug signals, ratchet de warnings/tamanho, budgets de
complexidade baseados em dados e só então boundaries/domain rules. Prettier,
TypeScript, max-lines e plugins arquiteturais não pertencem a esta fundação.

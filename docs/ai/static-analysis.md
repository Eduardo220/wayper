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
mede correção estática e budgets estruturais graduais; formatting e boundaries
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
  unused, imports, hooks, condição constante, duplicate export e budgets
  estruturais graduais.
- **OFF/não adicionado:** formatting, `no-console`, `max-statements` e
  architecture boundaries. Eles não são falsamente chamados de gate.

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
de 206 é a baseline pré-budget para burn-down, não autorização para ignorar
warning novo. Com as regras estruturais, o lint lê 267 arquivos e termina com
`0 errors / 336 warnings`: 206 preexistentes e 130 de budget, separados em
[`docs/ai/code-budgets.md`](code-budgets.md).

## Budgets estruturais

Distribuição, thresholds testados, ratchet, exceções, anti-gaming e ranking de
dívida pertencem a [`docs/ai/code-budgets.md`](code-budgets.md). O config usa
somente regras core: `max-lines`, `max-lines-per-function`, `complexity`,
`max-depth` e `max-params`, todas como warning no source de produção.

`npm run quality:size` é o gate bloqueante para arquivo novo acima de 350 linhas
significativas ou crescimento de arquivo legado registrado. Testes, scripts e
configs permanecem fora desse ratchet; `max-statements` continua measure-only.

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

O baseline machine-readable agora tem consumer único no ratchet e vive em
`scripts/quality/code-size-baseline.json`. Ele registra apenas dívida acima do
target, sem timestamp, e nunca é atualizado automaticamente.

## Saúde externa observada

`npx expo-doctor` passou 18/18 checks e `npx expo config --type public` resolveu
o manifest. `npm audit --json` reportou 46 advisories (1 low, 22 moderate, 22
high e 1 critical); remediation de dependencies é dívida fora deste setup.
Nenhum `npm audit fix` ou upgrade forçado foi executado.

## Próximos gates

CI futuro deve executar `npm run lint` e `npm run quality:size`; CI não foi
alterado aqui. Próximos passos são burn-down dos bug signals e
boundaries/domain rules baseadas em owners reais. Prettier, TypeScript,
`--max-warnings 0` e plugins arquiteturais não pertencem a esta fundação.

# Code Size + Complexity Budgets — Wayper mobile

> **Status:** vigente  
> **Escopo:** JavaScript de produção  
> **Owners:** [`eslint.config.js`](../../eslint.config.js) e
> [`scripts/quality/check-code-size.mjs`](../../scripts/quality/check-code-size.mjs)  
> **Baseline:** parent HEAD `df30014`, 2026-08-17

## Princípio

Código novo deve ser bom; legado não deve piorar; legado tocado melhora quando
isso for seguro e coeso. Aproximadamente 350 linhas é target de arquitetura para
source novo, não autorização para dividir arquivos artificialmente nem obrigação
de refatorar todo legado tocado.

O ESLint dá visibilidade local em `WARN`. `npm run quality:size` é o gate que
bloqueia arquivo novo acima do target e crescimento de dívida registrada. Source
e testes continuam sendo a verdade sobre comportamento; tamanho isolado não
autoriza refactor.

Linhas físicas servem para inventário. ESLint e ratchet contam linhas
significativas com `skipBlankLines` e `skipComments`; comentários úteis não são
punidos, mas removê-los também não representa melhoria arquitetural.

## Targets e enforcement

| Medida | Target | Threshold vigente | Mode |
| --- | ---: | ---: | --- |
| arquivo de produção | ~350 linhas significativas | 350 | ESLint `WARN` + ratchet bloqueante para novo/crescimento |
| arquivo de teste | ~750 linhas físicas para review | — | `MEASURE_ONLY`; fixtures/tabelas podem justificar mais |
| linhas por função | ~100 | 200 | ESLint `WARN` |
| complexidade ciclomática | ~15 | 50 | ESLint `WARN` |
| profundidade | 4 | 4 | ESLint `WARN` |
| parâmetros | 4 | 4 | ESLint `WARN` |
| statements por função | ~30 | — | `MEASURE_ONLY`; sobrepõe linhas/complexidade na cauda atual |

Targets orientam design novo. Thresholds de warning isolam a cauda do legado e
podem cair somente após burn-down medido; não são promessa de que valores abaixo
deles têm boa arquitetura.

## Baseline de tamanho

Produção contém 192 arquivos e 71.285 linhas físicas:

| Faixa física | Arquivos | Percentual |
| --- | ---: | ---: |
| `<=350` | 135 | 70,31% |
| `351–500` | 13 | 6,77% |
| `501–750` | 19 | 9,90% |
| `751–1000` | 13 | 6,77% |
| `1001–2000` | 9 | 4,69% |
| `2001–5000` | 2 | 1,04% |
| `>5000` | 1 | 0,52% |

Há 57 arquivos físicos acima de 350; a política significativa usada pelo gate
registra 51. Testes/fixtures somam 57 arquivos e 16.671 linhas: 41 `<=350`, 7 em
`351–500`, 7 em `501–750` e 2 em `1001–2000`. Scripts/plugins têm 14 arquivos e
1.835 linhas, todos `<=350`. Budgets de produção não são aplicados a testes,
scripts ou configs.

## Matriz de seleção

| Rule | Baseline | Thresholds testados → warnings | Sinal | Decisão |
| --- | --- | --- | --- | --- |
| `max-lines` | 57 físicos / 51 significativos `>350` | `350 → 51` | dívida visível; tamanho não prova responsabilidade | `ENABLE_WARN` + ratchet |
| `max-lines-per-function` | P95 60, P99 198, max 5.148 | `100 → 71`, `120 → 57`, `150 → 45`, `200 → 29` | funções extremas, sem forçar burn-down amplo | `ENABLE_WARN @200` |
| `complexity` | P95 20, P99 48, max 198 | `20 → 201`, `25 → 140`, `30 → 99`, `40 → 61`, `50 → 34` | cauda de branching com bom sinal | `ENABLE_WARN @50` |
| `max-depth` | P95 3, P99 4, max 5 | `3 → 45`, `4 → 12` | nesting extremo e pouco ruído | `ENABLE_WARN @4` |
| `max-params` | P95 3, P99 4, max 6 | `3 → 37`, `4 → 4`, `5 → 1` | API extensa com baixo ruído | `ENABLE_WARN @4` |
| `max-statements` | P95 21, P99 42, max 262 | `20 → 144`, `30 → 60`, `40 → 32`, `50 → 19`, `75 → 8` | redundante com tamanho/complexidade hoje | `MEASURE_ONLY` |

O lint final adiciona 130 warnings estruturais: 51 `max-lines`, 34
`complexity`, 29 `max-lines-per-function`, 12 `max-depth` e 4 `max-params`.
Eles são separados dos 206 warnings anteriores, especialmente dos 6
`react-hooks/rules-of-hooks` e 4 `import/export` classificados como bug signal.

## Ratchet de tamanho

O baseline determinístico está em
[`scripts/quality/code-size-baseline.json`](../../scripts/quality/code-size-baseline.json).
Ele registra somente os 51 arquivos de produção que já excedem 350 linhas
significativas; não possui timestamp nem findings individuais.

`npm run quality:size`:

1. lista source rastreado e untracked não ignorado em `App.js`, `index.js`,
   `googleAuth.js` e `src/`;
2. exclui testes/fixtures;
3. usa a regra core `max-lines` para aplicar a mesma contagem do ESLint;
4. aceita legado igual ou menor que sua baseline;
5. falha em crescimento legado ou arquivo novo acima de 350;
6. reporta melhorias sem atualizar o baseline automaticamente.

Exit `0` significa nenhuma regressão/nova violação. Exit `1` significa schema,
argumento, parse, exceção ou budget inválido. O output normal é compacto;
`npm run quality:size -- --details` acrescenta melhorias detectadas.

### Atualização e exceções

O baseline nunca é atualizado por hook, CI ou flag automática. Depois de uma
redução legítima: valide comportamento, revise a extração e reduza explicitamente
o número do arquivo no JSON para impedir que a dívida volte. Crescimento só pode
ser aceito por review com uma exceção específica, limitada e justificada:

```json
"exceptions": {
  "src/example.js": {
    "max": 420,
    "reason": "Tabela coesa exigida pelo framework"
  }
}
```

Não use ignore global ou dezenas de `eslint-disable max-lines`. Exceção deve ter
arquivo, limite e motivo revisáveis; exceder o limite continua falhando.

## Política de mudança

- **Novo source:** buscar `<=350`; acima disso exige examinar responsabilidades,
  extração natural, coesão e constraint de framework/generated. Sem justificativa
  explícita, o ratchet falha.
- **Legado `>350`:** typo, copy ou bug mínimo não exige decomposição. Mudança
  substancial não deve aumentar a baseline; extração só ocorre quando a boundary
  é natural e testável.
- **Testes:** measure-only nesta unidade. Tabelas e fixtures grandes podem ser
  coesas; duplicação, responsabilidades e legibilidade determinam refactor, não
  o limite de produção.
- **Funções:** warnings pedem review estrutural, não extração automática. Um
  helper que apenas desloca branching não melhora a arquitetura.

Não vale minificar, juntar statements, apagar documentação útil, criar
`foo1/foo2`, barrel artificial, util genérico sem coesão, mover complexidade sem
ownership ou trocar uma função por callbacks anônimos para enganar métricas.

## God-object priority

Prioridade combina tamanho, maior função/complexidade, responsabilidades,
frequência de mudança, consumers, risco de runtime e densidade de warnings.
Graphify apontou conexões amplas; imports, source, docs e testes confirmaram os
owners abaixo. O ranking é triagem, não autorização de refactor.

| # | Arquivo | Linhas físicas | Função max | Complexidade max | Responsabilidades / risco | Prioridade |
| ---: | --- | ---: | ---: | ---: | --- | --- |
| 1 | `src/screens/MapScreen.js` | 7.199 | 5.148 | 198 | UI/mapa, integração lifecycle/finish/deferred; runtime crítico | `CRITICAL` |
| 2 | `src/services/runTracking/activeRunTrackingService.js` | 4.995 | 391 | 86 | ingestão, transições, checkpoints e bridge nativa; perda de corrida | `CRITICAL` |
| 3 | `src/utils/sync.js` | 2.363 | 249 | 145 | save local, normalização, payload e sync remoto; durabilidade | `CRITICAL` |
| 4 | `src/services/runTracking/activeRunState.js` | 1.296 | 150 | 106 | schema/merge/métricas do snapshot canônico | `CRITICAL` |
| 5 | `src/services/run/runFinalizationService.js` | 636 | 161 | 52 | save mínimo, idempotência e cleanup da corrida | `CRITICAL` |
| 6 | `src/services/runOfflineStorageService.js` | 677 | 169 | 70 | checkpoint/rascunho compatível e recovery local | `CRITICAL` |
| 7 | `src/services/runTracking/activeRunRuntimeService.js` | 546 | 178 | 105 | integração runtime/surface e evidência recuperável | `CRITICAL` |
| 8 | `src/services/tracking/trackingPathService.js` | 987 | 347 | 55 | filtros, segmentos, distância e render path | `CRITICAL` |
| 9 | `src/services/run/runRecoveryService.js` | 833 | 97 | 49 | detecção, conflito, migração e cleanup de recovery | `CRITICAL` |
| 10 | `src/services/run/runDeferredTaskQueueService.js` | 1.553 | 151 | 56 | enqueue, retry/replay e derivados pós-save | `HIGH` |
| 11 | `src/components/Map/WayperMapLibre.js` | 1.444 | 619 | 60 | layers, camera, gestures e adaptação geo/render | `HIGH` |
| 12 | `src/services/territory/territoryCaptureService.js` | 650 | 429 | 78 | captura territorial, progressão e falhas deferidas | `HIGH` |
| 13 | `src/services/territory/territoryStorageService.js` | 806 | 60 | 88 | normalização, serialização e storage territorial | `HIGH` |
| 14 | `src/screens/DiagnosticsScreen.js` | 873 | 514 | 156 | preferências, filas, export e upload diagnóstico | `HIGH` |
| 15 | `src/screens/Runs/RunDetailScreen.js` | 1.566 | 603 | 76 | detalhe, edição, remoção, export e share | `HIGH` |

### Hotspots protegidos

`MapScreen` permanece em 7.199 linhas físicas / 6.825 significativas. Uma futura
mudança estrutural exige `SAFE_REFACTOR + ARCHITECTURAL`, dependency/ownership
map, characterization tests e extrações incrementais; big-bang rewrite é
proibido.

`activeRunTrackingService` permanece em 4.995 linhas físicas / 4.788
significativas. Como owner `CRITICAL_RUNTIME`, reduzir tamanho nunca supera
segurança de tracking, lifecycle, concorrência, recovery ou persistência.
Nenhum dos dois foi refatorado nesta unidade.

## Próximo boundary

Architecture boundaries, import rules, max-lines como error, warning ratchet de
função e CI ficam fora desta unidade. A Unidade 8 pode usar estes dados para
enforcement de domínio sem misturar tamanho com ownership.

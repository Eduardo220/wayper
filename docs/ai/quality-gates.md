# Adaptive Quality Gates — Wayper AI Harness

> **Status:** vigente  
> **Escopo:** seleção de validação, review e síntese de qualidade  
> **Owner:** [`harness-v1.md`](harness-v1.md)  
> **Entradas:** classe, risk flags, domínios e diff real

Este documento seleciona evidência proporcional à mudança. Ele não é um
orquestrador executável, Brain ou substituto de julgamento técnico. O agente
principal aplica a matriz, executa os checks e sintetiza reviews. Nenhuma
dimensão de qualidade substitui outra.

## Dimensões

| Dimensão | Pergunta |
| --- | --- |
| `CORRECTNESS` | O comportamento requerido funciona no cenário real? |
| `STATIC_SAFETY` | Lint detectou erro ou sinal conhecido novo? |
| `STRUCTURE` | Budgets de tamanho/complexidade regrediram? |
| `ARCHITECTURE` | Boundary ou ownership regrediu semanticamente ou por import? |
| `REGRESSION` | Testes relevantes e existentes continuam verdes? |
| `DOMAIN_RISK` | Há risco específico de lifecycle, persistence, geo ou outro domínio? |
| `RUNTIME_SAFETY` | A mudança pode perder corrida, estado ou dado durável? |
| `BUILD_HEALTH` | Expo, config e dependências tocadas continuam coerentes? |

Uma tarefa não trivial usa internamente:

```text
TASK_CLASS | RISK_FLAGS | DOMAINS | CONTEXT_LEVEL | GATE_LEVEL | REVIEW_MODE
SKILLS | SPECIALISTS | VALIDATION
```

## Gate levels

| Nível | Quando | Obrigatório | Acrescentar por diff/risco |
| --- | --- | --- | --- |
| `Q0 — TARGETED` | `TRIVIAL`: typo, copy/doc pequena, rename inequívoco | prova diretamente relevante e `git diff --check` quando há arquivos | link check ou lint do arquivo se a sintaxe justificar |
| `Q1 — FAST` | default de `BOUNDED` e bug simples | targeted test quando existir; `npm run quality:gate` | lint/config check específico do arquivo tocado |
| `Q2 — DEEP` | bug relevante, múltiplos arquivos, persistence, Firebase, native, geo, arquitetura ou refactor | FAST + full Jest quando o impacto não puder ser isolado; review proporcional | Expo/config, specialist, dependências ou Graphify somente pelo diff |
| `Q3 — CRITICAL` | `CRITICAL_RUNTIME`, `RUN_DATA_LOSS`, migration crítica, auth/security material ou lifecycle nativo crítico | baseline explícita, regression direcionada, full Jest, gates estáticos/arquiteturais, failure-mode review e painel de specialists pelas flags | validação física quando o comportamento depende de aparelho |

`Q0/Q1` não executam full Jest, Expo Doctor, Graphify ou painel por reflexo.
`Q3` não pode ser concluído apenas porque lint passou.

## Review modes

| Modo | Uso | Contrato |
| --- | --- | --- |
| `R0 — NONE` | trivial/mecânico com prova suficiente | nenhum reviewer adicional |
| `R1 — NATIVE_REVIEW` | bounded não trivial, bug comum, feature pequena | agente principal ou capacidade genérica nativa; não criar custom reviewer |
| `R2 — SPECIALIST_REVIEW` | uma flag casa com um specialist Wayper | um reviewer read-only no risco correspondente |
| `R3 — SPECIALIST_PANEL` | duas ou mais flags independentes justificam lentes distintas | `S2 — PARALLEL_READ`; reviewers independentes não compartilham findings antes da síntese |

`LOW/MEDIUM` isolado não escala review. `HIGH` com baixa confiança exige mais
evidência ou uma segunda lente relevante. `CRITICAL` recebe confirmação
independente quando praticável. Não se repetem reviewers para buscar consenso.

## Matriz de seleção

Classe e flags definem o piso; domínio e diff podem elevar, nunca reduzir risco
comprovado.

| Classe | Flags/domínio/diff | Gate | Review |
| --- | --- | --- | --- |
| `TRIVIAL` | documentação/copy apenas | `Q0` | `R0` |
| `BOUNDED` | `UI_UX`, mudança local | `Q1` | `R1` se houver comportamento |
| `BUG` | UI local, impacto delimitado | `Q1`; `Q2` se impacto/consumers amplos | `R1` |
| `BUG` | `OFFLINE_STORAGE`, `SYNC`, `DATA_MIGRATION` | `Q2` | `R2` persistence |
| `BUG` | `GPS_GEO` | `Q2`; `Q3` se perda de corrida/dado | `R2` geospatial |
| `ARCHITECTURAL` ou `SAFE_REFACTOR` | qualquer domínio | mínimo `Q2` | `R1` + specialists somente pelas flags |
| qualquer | `CRITICAL_RUNTIME` + `LIFECYCLE` + `CONCURRENCY` | `Q3` | `R3` lifecycle + concurrency |
| qualquer | `CRITICAL_RUNTIME` + `OFFLINE_STORAGE` + `CONCURRENCY` | `Q3` | `R3` persistence + concurrency |
| qualquer | `GPS_GEO` + `LIFECYCLE` | `Q3` quando runtime crítico | `R3` geospatial + lifecycle |
| qualquer | `AUTH_SECURITY`/`FIREBASE` material | mínimo `Q2` | lente nativa específica; persistence só se durabilidade/sync mudar |

Não chame persistence só porque a mudança envolve corrida, nem geospatial só
porque existe um mapa na UI.

## Diff-aware elevation

Antes do gate, leia `git diff` e arquivos tocados. O classificador sozinho não
basta.

| Delta observado | Evidência adicional |
| --- | --- |
| `package.json`, lockfile, Expo/Metro/Babel/EAS | dependency check e Expo config/Doctor proporcionais |
| `eslint.config.js` ou script quality | lint canônico + teste do tooling |
| baseline size/architecture/lint | gate correspondente + review explícito da baseline; nunca atualização automática |
| runtime/task/native Android | testes de owner, lifecycle/failure mode e possível validação física |
| repository/storage/migration/Firebase | testes de persistência/rollback/idempotência; specialist pelas flags |
| geometry/Turf/coordinates/MapLibre data | testes geo e geospatial reviewer |
| docs only | link/consistência; não exigir Expo Doctor |

Targeted tests vêm do teste diretamente associado, owner, skill ou módulos
alterados. Não existe test-impact engine. Se a relação não for confiável, `Q2/Q3`
usa a suíte completa.

## FAST e DEEP

FAST:

- lint oficial em JSON com delta;
- `quality:size`;
- `quality:architecture`;
- targeted tests quando houver relação confiável;
- `git diff --check`.

`npm run quality:gate` agrega os checks FAST de repositório em paralelo e tem
output curto; targeted tests continuam separados porque dependem da tarefa. O
comando aceita `--details` ou `--json`. Ele não roda Jest completo, Expo Doctor
ou review.

DEEP, somente quando selecionado:

- full Jest;
- Expo Doctor e `expo config` para stack/config/dependency;
- specialist ou painel seletivo;
- failure-mode e dependency review;
- Graphify para relação ampla/incerta, sempre confirmada no source;
- validação física quando Jest não prova o comportamento.

`quality:architecture` prova imports/owners codificados, não semântica completa;
tarefa `ARCHITECTURAL` mantém review. `quality:size` prova ratchet, não coesão ou
preservação de comportamento; `SAFE_REFACTOR` revisa ambos e rejeita gaming.

## Delta-first e bug signals

Todo check relevante separa `PREEXISTING`, `NEW` e `RESOLVED`. Dívida intacta
não é atribuída ao diff; melhoria numérica também não prova correctness.
Tarefa não trivial registra `BEFORE -> AFTER -> DELTA` dos checks executados.

O baseline lint versionado guarda contadores por `file + rule` e assinaturas
estáveis `file + rule + message` dos dez bug signals, não AST, output bruto ou
artefato por execução. O ESLint JSON oficial alimenta o gate.
Baseline atual de `BUG_SIGNAL_PREEXISTING`:

- `react-hooks/rules-of-hooks`: 6;
- `import/export`: 4.

Política:

- `NEW_LINT_ERROR` e `BUG_SIGNAL_NEW`: bloqueiam;
- `BUG_SIGNAL_TOUCHED`: exige review explícito da área; sem evidência suficiente,
  o gate fica `INCONCLUSIVE`;
- warning geral novo: visível como `PASS_WITH_DEBT`, salvo gate mais forte;
- warning legado inalterado: pode resultar em `PASS` quando não é relevante;
- resolved é reportado, mas não compensa problema novo de outra categoria.

O baseline não possui comando de update. Mudá-la é uma decisão revisada, não
efeito colateral da execução.

## Finding contract

Todo finding técnico contém:

| Campo | Regra |
| --- | --- |
| `SEVERITY` | `CRITICAL`, `HIGH`, `MEDIUM` ou `LOW` |
| `FILE` | path real |
| `LINE` | linha/range quando aplicável |
| `CLAIM` | uma afirmação objetiva |
| `FAILURE_SCENARIO` | input, estado, race ou sequência concreta que quebra |
| `EVIDENCE` | diff/source/test/log que sustenta o claim |
| `EXISTING_SAFEGUARD` | proteção atual e por que evita, reduz ou não cobre o cenário |
| `CONFIDENCE` | `HIGH`, `MEDIUM` ou `LOW` |

Sem failure scenario, não é bug confirmado. Safeguard que cobre o cenário
rebaixa ou rejeita o finding. Style, “arquivo grande”, “muita complexidade” e
“poderia extrair helper” não são findings de correção por si sós.

## Severity e confidence

| Severity | Significado | Default |
| --- | --- | --- |
| `CRITICAL` | perda/corrupção de dados, exploit material, corrida perdida, crash sistemático crítico ou irreversibilidade | bloqueia |
| `HIGH` | bug/race concreta relevante, comportamento comum incorreto ou regression importante | bloqueia se confirmado |
| `MEDIUM` | edge case, maintainability risk concreto ou test gap relevante | normalmente não bloqueia |
| `LOW` | melhoria opcional com impacto pequeno | não bloqueia |

| Confidence | Evidência |
| --- | --- |
| `HIGH` | source + reproduction/test demonstram |
| `MEDIUM` | source sustenta; reprodução parcial |
| `LOW` | hipótese plausível sem prova suficiente |

Claim de severidade alta com confidence baixa não permanece confirmado: obtenha
evidência ou classifique `UNRESOLVED`.

## Synthesis

O agente principal executa `collect -> normalize -> dedupe -> verify -> check
safeguards -> confidence -> contradictions -> rank -> blocking`.

- Duplicata = mesma causa + mesmo failure scenario; preserve a evidência mais
  forte e registre outros reviewers apenas como corroboration.
- Discordância não usa maioria. Source, testes, runtime contract e arquitetura
  classificam o claim como `CONFIRMED`, `REJECTED` ou `UNRESOLVED`.
- `UNRESOLVED` não vira bug confirmado; primeiro investigue/replaneje.
- Finding fora do diff e sem relação causal vira debt/follow-up, não blocker.
- Zero findings é resultado válido.

Em `R3`, reviewers trabalham isoladamente no mesmo diff read-only. Eles não
votam, conversam ou recebem findings alheios antes da síntese.

## Blocking e estados

Bloqueiam por default:

- `CRITICAL` ou `HIGH` confirmado com failure scenario;
- lint error ou bug signal novo;
- size ou architecture regression;
- teste falhando por causa da mudança;
- gate obrigatório não satisfeito.

Falha de teste preexistente conhecida não é atribuída ao diff sem causalidade.
Falha de ferramenta é `TOOL_FAILURE`; contexto ausente é `CONTEXT_MISSING`.
Somente falha transitória de tooling recebe um retry racional.

| Estado | Contrato |
| --- | --- |
| `PASS` | gates obrigatórios verdes, sem finding bloqueante |
| `PASS_WITH_DEBT` | mudança correta; somente dívida nova/relevante e não bloqueante registrada |
| `FAIL` | falha reproduzível ou blocker confirmado |
| `INCONCLUSIVE` | evidência insuficiente; investigar/replanejar antes de concluir |

`PASS_WITH_DEBT` lista apenas `NEWLY_RELEVANT_DEBT`, nunca todo o backlog.

## Physical validation

Screen-off, background Android, notification action, headless task, foreground
service e GPS real podem exigir aparelho. Quando o código passa mas essa prova
não ocorreu, registre:

```text
CODE_GATES_PASS
PHYSICAL_VALIDATION_PENDING
```

Se a prova física for obrigatória em `Q3`, o resultado global continua
`INCONCLUSIVE`. Nunca alegue execução física sem evidência.

## Specialist routing

| Flags | Specialist |
| --- | --- |
| `CONCURRENCY` | `wayper_concurrency_reviewer` |
| `LIFECYCLE`, `NATIVE_ANDROID` | `wayper_mobile_lifecycle_reviewer` |
| `OFFLINE_STORAGE`, `SYNC`, `DATA_MIGRATION`, Firebase persistence-relevant | `wayper_persistence_reviewer` |
| `GPS_GEO`, `TERRITORY_GEO` | `wayper_geospatial_reviewer` |

`AUTH_SECURITY` usa lente nativa sobre auth boundary, permissions,
fail-open/fail-closed, privacy, config/secrets, imports e local-first quando
aplicável. Não existe custom security reviewer.

## Learning delta e conclusão

Entre waves/reviews, propague somente fatos relevantes classificados como
`NEW_FACTS`, `NEW_PITFALLS`, `NEW_DEPENDENCIES`, `REJECTED_ASSUMPTIONS` ou
`NEW_DECISIONS`; não copie o histórico. Em Meta Goal, o formato, filtro por
relevância e boundary de não persistência pertencem a
[`meta-goal-runtime.md`](meta-goal-runtime.md).

Síntese interna final:

```text
QUALITY_STATUS
CHECKS_RUN
DELTA (BEFORE | AFTER | NEW | RESOLVED)
BLOCKING_FINDINGS
NONBLOCKING_FINDINGS
PHYSICAL_VALIDATION
FOLLOW_UPS
```

O resultado externo permanece compacto. Evals de seleção, review, confidence e
falsos positivos vivem em [`routing-evals.md`](routing-evals.md).

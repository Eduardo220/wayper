# Meta Goal Runtime + Autonomy Contract — Wayper AI Harness

> **Status:** vigente  
> **Escopo:** metas amplas, autonomia técnica e continuidade incremental  
> **Owner:** [`harness-v1.md`](harness-v1.md)  
> **Router:** [`context-routing.md`](context-routing.md)  
> **Quality:** [`quality-gates.md`](quality-gates.md)  
> **Rollout:** `ACTIVE`; baseline, contract evals e shadow aprovados em
> 2026-08-24

Este contrato ensina o agente principal a transformar um resultado de alto nível
em slices técnicos seguros. É política declarativa, não planner, Brain, daemon,
runtime de memória ou runtime JS. O Codex continua sendo executor e orquestrador.

## Contrato da meta

Uma meta possui quatro campos; o usuário pode fornecer apenas o resultado e o
agente deriva o restante do repositório quando isso não inventa produto.

```text
GOAL: resultado desejado de alto nível
SUCCESS_CRITERIA: condições observáveis de conclusão
CONSTRAINTS: regras que não podem ser violadas
NON_GOALS: trabalho que não deve ser perseguido
```

`SUCCESS_CRITERIA` precisa ser verificável por source, testes, quality gates,
métrica ou evidência externa explícita. “Parece melhor” não encerra uma meta.
Critérios contraditórios atravessam o Human Decision Boundary.

## Goal Execution Contract

Meta Goal mantém um contrato operacional durante a execução. Ele pode viver no
estado nativo da sessão e no relatório; não precisa ser persistido como JSON nem
autoriza um segundo runtime.

```text
GOAL_EXECUTION

goal:
  id | mode | objective | started_at
budget:
  requested_token_budget | requested_duration_budget
  harness_token_ceiling | harness_duration_ceiling
  native_effective_token_budget | native_effective_duration_budget | propagation_status
  token_enforcement_mode | duration_enforcement_mode
  tokens_used | token_accounting_source | elapsed
  soft_limit_entered | hard_limit_exceeded | overshoot
  tokens_at_canonical_terminal | tokens_at_native_terminal
  post_terminal_token_delta | substantive_post_terminal_work
success_criteria: []
candidates: []
slices: []
specialists: []
evidence: []
validation: []
uncertainties: []
falsification:
  performed | result | findings
completion:
  state | eligible | stop_reason | early_completion
```

O contrato separa obrigatoriamente:

```text
WORK_EXECUTED != GOAL_PROVEN_SATISFIED
IMPLEMENTATION_EXISTS != GOAL_PROVEN_SATISFIED
TEST_PASS != AUTOMATIC_SEMANTIC_CORRECTNESS
FAST_HOOK_PASS != GOAL_SATISFIED
NOT_RUN != PASS
EMULATOR_PASS != PHYSICAL_DEVICE_PASS
TOKEN_ACCOUNTING != TOKEN_BUDGET_ENFORCEMENT
REQUESTED_BUDGET != EFFECTIVE_BUDGET
HARNESS_TOKEN_CEILING != NATIVE_GOAL_TOKEN_BUDGET
HARNESS_TOKEN_BUDGET_CONTROL != NATIVE_TOKEN_BUDGET_ENFORCEMENT
HARNESS_TOKEN_BUDGET_CONTROL_READY != END_TO_END_TOKEN_BUDGET_ENFORCEMENT_READY
BUDGET_CONTROL != COMPLETION_PROOF
```

### Ledgers

- **Success Criteria Ledger:** cada critério tem `PENDING`, `SATISFIED`,
  `BLOCKED` ou `NOT_APPLICABLE`. `SATISFIED` referencia evidence concreta;
  `NOT_APPLICABLE` registra motivo e evidence verificável do changed scope.
- **Evidence Ledger:** cada claim material aponta para `file`, `line/range`,
  `test`, `command`, `validator`, `runtime output`, `config`, `commit` ou
  comportamento observado. “Parece correto” não é provenance.
- **Validation Ledger:** cada validação derivada do changed scope usa `NOT_RUN`,
  `PASS`, `FAIL`, `NOT_APPLICABLE` ou `BLOCKED`, com comando/evidence e owner.
- **Uncertainty Ledger:** cada incerteza usa severidade `BLOCKING`, `MATERIAL` ou
  `MINOR` e estado `OPEN` ou `RESOLVED`. Incerteza material aberta explicita
  tratamento, mitigação ou justificativa e impacto no resultado.
- **Slice Accounting:** candidate e slice registram decisão e status real, sem
  mínimo artificial. Tarefa simples pode usar um candidate, um slice e zero
  specialists.

Evidence pode sustentar vários ledgers por referência; não duplique output ou
reasoning. Chain of thought não é coletado, persistido nem exigido.

## Integração com Goal mode

Na baseline local de 2026-08-24, Codex CLI `0.149.0` reporta a feature `goals`
como `stable` e a sessão expõe operações nativas de criação, consulta e
conclusão/bloqueio de Goal. O CLI não expõe subcomando `goal`; portanto o projeto
não documenta nem simula sintaxe de terminal.

Capability audit observável de 2026-08-24 para esta integração:

| Capability | Status | Evidence |
| --- | --- | --- |
| token accounting | `SUPPORTED` | `get_goal.tokensUsed` é monotônico nos snapshots observados |
| elapsed accounting | `SUPPORTED` | `get_goal.timeUsedSeconds` é observável |
| campo de criação `token_budget` | `SUPPORTED` | schema integrado aceita inteiro positivo opcional |
| propagação nativa pela model tool atual | `UNSUPPORTED_CURRENT_MODEL_TOOL` | `/goal` cria antes da leitura do texto; `remainingTokens=null` |
| `GOAL_TOKENS` textual | `HARNESS_ONLY` | define request/ceiling do Harness; não configura native Goal |
| native token hard cap | `UNKNOWN` | accounting não prova enforcement |
| native remaining tokens | `UNKNOWN` | retorno `null`; não derivar nem mascarar |
| native duration budget | `UNSUPPORTED` | criação integrada não expõe duração |
| budget update pela model tool | `UNSUPPORTED` | `update_goal` aceita somente `complete` ou `blocked` |
| budget terminal pela model tool | `UNSUPPORTED` | não aceita `GOAL_BUDGET_EXHAUSTED` |
| post-terminal accounting | `SUPPORTED` | `122278 -> 142234`; delta observável `19956` |
| usage monotonicity | `SUPPORTED` observado | snapshots cresceram; granularidade intra-fase é `UNKNOWN` |

Status descreve esta superfície integrada, não capability genérica externa.

- `GOAL_NATIVE_AVAILABLE`: prefira o lifecycle nativo para outcome, success
  criteria e execução longa; este documento fornece a política Wayper interna.
- `GOAL_NATIVE_UNAVAILABLE`: aplique o mesmo contrato durante a task/sessão
  normal até o limite do ambiente.
- Nunca crie scheduler, daemon, loop infinito ou arquivo `goal-loop` como
  fallback. O Harness permanece portátil e capability-based.

```text
CODEX GOAL MODE (quando exposto pelo runtime)
  -> WAYPER GOAL CONTRACT
     -> EXECUTION KERNEL
        -> CLASSIFIER / ROUTER / PROCESS
           -> DOMAIN SKILLS
              -> QUALITY / REVIEW
                 -> RE-MEASURE
                    -> NEXT SAFE SLICE ou STOP
```

Goal mode não altera approval mode nem concede autorização para push, merge,
deploy, billing, credenciais, mutação de produção ou ação destrutiva.

## Task mode e Meta Goal mode

| Modo | Intenção | Depois do slice |
| --- | --- | --- |
| `TASK_MODE` | resultado pontual e finito | validar, entregar e `STOP` |
| `META_GOAL_MODE` | outcome contínuo que admite vários slices | re-observar, re-rankear e continuar enquanto o Goal Budget permitir |

Tamanho não define o modo. Uma task grande e finita continua `TASK_MODE`; a
palavra “meta” em copy, source ou documentação não ativa o loop. O router usa a
intenção explícita de progresso contínuo.

## Autonomy Contract

```text
AUTONOMY_MAXIMIZED
HUMAN_INTERRUPTION_MINIMIZED
DO NOT ASK THE HUMAN WHAT THE REPOSITORY CAN ANSWER
```

Antes de considerar uma pergunta, investigue proporcionalmente: source atual,
testes, documentação canônica, decisões técnicas, Git/history quando útil,
padrões existentes, constraints e inferência conservadora baseada em evidência.
Não é necessário esgotar o repositório; é necessário procurar onde o owner vive.

| Resultado | Quando | Ação |
| --- | --- | --- |
| `AUTO_DECIDE` | decisão técnica, evidência suficiente, padrão/owner existente, reversível, sem regra nova de produto e validável | decidir, executar e provar |
| `AUTO_DECIDE_CONSERVATIVE` | ambiguidade técnica material, opções reversíveis e uma alternativa claramente menos arriscada | registrar assumption, escolher a opção conservadora, executar e validar |
| `HUMAN_DECISION_REQUIRED` | decisão essencialmente humana permanece depois da investigação | parar somente o trabalho dependente e enviar um Decision Packet |

Nomes internos, localização de teste, uso de owner existente, seleção de gate,
specialist, Graphify/source search, wave e ordem de validação normalmente são
autônomos. Reversibilidade e provas fortes aumentam autonomia.

`HUMAN_DECISION_REQUIRED` é restrito a regra de produto ausente; UX material com
alternativas incompatíveis; mudança estratégica/contrato externo; ação
destrutiva ou migração irreversível; credencial/permissão/custo externo; decisão
jurídica, privacy ou security de produto; duas arquiteturas materialmente
distintas com trade-off estratégico; ou success criteria contraditórios. Dúvida,
trabalho difícil ou preferência do agente não satisfazem essa boundary.

YOLO, `always approve`, `never ask`, `full auto` e bypass de confirmação não são
política do Harness. Autonomia técnica e autorização operacional são dimensões
separadas.

### Question economy e Decision Packet

Antes de perguntar, verifique internamente:

```text
SEARCHED_SOURCE: YES | NO | NOT_APPLICABLE
SEARCHED_DOCS: YES | NO | NOT_APPLICABLE
CHECKED_TESTS: YES | NO | NOT_APPLICABLE
CHECKED_HISTORY: YES | NO | NOT_APPLICABLE
CONSERVATIVE_OPTION_EXISTS: YES | NO
```

Quando a decisão humana for inevitável, não pergunte “o que você quer fazer?”.
Agrupe decisões acopladas e envie:

```text
DECISION:
CONTEXT:
OPTIONS:
RECOMMENDATION:
IMPACT:
DEFAULT_IF_POSTPONED:
QUESTION:
```

Duas decisões independentes já bloqueantes podem ser agrupadas. Se a segunda
depende da primeira, pergunte só a decisão upstream.

## Ambiguity Gate

A ambiguidade é avaliada depois da busca no repositório.

| Nível | Resultado |
| --- | --- |
| `AMBIGUITY_LOW` | `AUTO_DECIDE` |
| `AMBIGUITY_MATERIAL` técnica + reversível | `AUTO_DECIDE_CONSERVATIVE` |
| `AMBIGUITY_MATERIAL` de produto/estratégia | `HUMAN_DECISION_REQUIRED` |
| `AMBIGUITY_CRITICAL` | `HUMAN_DECISION_REQUIRED` |

O Harness implementa produto definido, mas não inventa regra ausente. Quando a
fonte aprovada responde, aplique-a; quando duas experiências de produto
incompatíveis continuam válidas, preserve a decisão humana.

## Execution Kernel

Trabalho não trivial segue a sequência abaixo, referenciando os owners em vez de
duplicá-los:

1. `GROUND_TRUTH` — Git, estado, source e comandos reais.
2. `RESOLVE_INTENT` — outcome, success, constraints e non-goals.
3. `CLASSIFY` — [`task-classification.md`](task-classification.md).
4. `RISK` — flags e override crítico.
5. `AMBIGUITY` — somente após investigação proporcional.
6. `DECISION_BOUNDARY` — auto, conservador ou humano.
7. `LOAD_MINIMUM_CONTEXT` — [`context-routing.md`](context-routing.md).
8. `ENTRY_CAPABILITY` — Pass 1 do
   [`capability-architecture.md`](capability-architecture.md).
9. `SOURCE_DEPENDENCY_WALK` — consumers, owner, contract e producer aplicáveis.
10. `DEPENDENCY_EXPANSION / CONTEXT_CLOSURE` — Pass 2 somente por evidence.
11. `BUILD_CANDIDATES / PLAN` — top candidates, sem backlog exaustivo.
12. `SELECT_SAFE_SLICE` — menor melhoria observável e reversível.
13. `BASELINE` — prova before proporcional.
14. `IMPLEMENT` — owner atual, reuse-first, menor delta.
15. `TARGETED_PROOF` — teste/evidência diretamente causal.
16. `QUALITY_GATE` — Q0-Q3 de [`quality-gates.md`](quality-gates.md).
17. `REVIEW` — R0-R3 pelas flags do slice.
18. `SYNTHESIZE` — evidência, safeguards, dedupe e blockers.
19. `RE-MEASURE` — before, after, delta e quality status.
20. `COMMIT WHEN APPROPRIATE` — slice integrado e coerente, se autorizado.
21. `LEARNING_DELTA` — apenas novidades relevantes.
22. `FOLLOW_UPS` — classificar e deduplicar descobertas.
23. `CONTINUE_OR_STOP` — re-rankear ou aplicar stop condition.

Em `TASK_MODE`, o passo 23 termina após o objetivo pontual. Em
`META_GOAL_MODE`, ele retorna ao passo 1 com o estado atual, nunca com um plano
antigo presumido correto. O working set de capability também volta ao Pass 1:
não acumule skills entre slices; preserve somente Learning Delta relevante.

## Candidates e ranking

Descoberta inicial gera três a sete candidates relevantes, não um inventário do
repo inteiro:

```text
CANDIDATE_ID | DESCRIPTION | DOMAIN | CLASS | RISK_FLAGS
EXPECTED_IMPACT | CONFIDENCE | VALIDATION_STRENGTH
COUPLING | ESTIMATED_COST | REVERSIBILITY | DEPENDENCIES
```

Ranking compara impacto, confiança, força de validação e redução de dívida
contra risco, coupling, custo e incerteza. Não exige fórmula numérica. Prefira
alto valor, boa observabilidade e risco controlável; tamanho, warning count e
complexidade isolados nunca escolhem o próximo alvo. Um hotspot `HIGH` isolado
pode preceder um monólito `CRITICAL` pouco observável.

Após cada slice, candidate pode `REMAIN`, `IMPROVE`, `BECOME_IRRELEVANT`,
`BECOME_BLOCKED` ou `ESCALATE_RISK`; re-rankear evita seguir plano por inércia.
Graphify só entra quando a descoberta estrutural realmente reduzir incerteza, e
source confirma seus resultados. O Discovery Budget não gasta mais contexto
mapeando candidates do que executando a melhoria.

## Safe Slice e progresso

Um safe slice é a menor fatia que produz melhoria observável, pode ser validada
e revertida e não mistura mudanças independentes. Cada slice não trivial retém:

```text
BASELINE | CHANGE | VALIDATION | REVIEW
BEFORE | AFTER | DELTA | QUALITY_STATUS
```

Não use “refatorar MapScreen” como slice único. Melhoria métrica não substitui
correção semântica, e a política anti-gaming de size/architecture continua
vigente. A meta progride em slices; não precisa produzir um mega diff.

Subagents nunca fazem commit. O agente principal pode commitar um slice quando
ele está integrado, quality/review requeridos passam e o commit é uma unidade
coerente. Não fragmente alteração mínima nem acumule mudanças independentes.
Push permanece ação externa separadamente autorizada.

## Goal Budget

Continue somente enquanto houver:

```text
MEANINGFUL_EXPECTED_VALUE
+ SUFFICIENT_CONFIDENCE
+ ADEQUATE_VALIDATION
```

Encerre por `ROI_EXHAUSTED` quando restarem apenas micro cleanup, estética,
abstração especulativa, baixo valor, validação fraca ou risco desproporcional.
Tempo pode ser constraint, mas não é o único budget. O objetivo é melhoria
mensurável, não perfeição infinita.

Budgets são tetos, nunca quotas. Token, duração, candidates, slices, specialists,
tool calls ou testes não recebem mínimos artificiais. Formalmente:

```text
BUDGET_REMAINING != WORK_REMAINING
```

No `GOAL_START`, resolva antes de trabalho pesado:

```text
Budget Request -> Runtime Capabilities -> Effective Budget -> Enforcement Mode
```

Registre `requested_*`, `harness_*`, `native_effective_*` e propagação
separadamente. `GOAL_TOKENS`/`GOAL_DURATION` no prompt são request; quando a
model tool não os propaga, tornam-se `HARNESS_TOKEN_CEILING` e
`HARNESS_DURATION_CEILING`. Nunca viram native/effective budget sem read-back.
Enforcement usa `NATIVE | HARNESS | HYBRID | OBSERVATIONAL_ONLY | UNAVAILABLE`.
`HARNESS` controla checkpoints quando usage confiável existe; não promete hard
cap entre checkpoints nem controla toda continuação do lifecycle nativo.

Readiness normativa:

```text
TOKEN_ACCOUNTING_READY
HARNESS_TOKEN_BUDGET_CONTROL_READY
NATIVE_TOKEN_BUDGET_PROPAGATION_READY
NATIVE_TOKEN_BUDGET_ENFORCEMENT_READY
END_TO_END_TOKEN_BUDGET_ENFORCEMENT_READY
SOFT_BUDGET_CONTROL_READY
POST_TERMINAL_TOKEN_ACCOUNTING_READY
```

Para a model tool observada:

```text
NATIVE_TOKEN_BUDGET_PROPAGATION_READY=UNSUPPORTED_CURRENT_MODEL_TOOL
NATIVE_TOKEN_BUDGET_ENFORCEMENT_READY=UNKNOWN
END_TO_END_TOKEN_BUDGET_ENFORCEMENT_READY=NO
```

`END_TO_END...` permanece `NO` enquanto tokens puderem crescer após o terminal
canônico fora do controle do Harness. Accounting e checkpoint stop não mudam
essa conclusão.

A política central em `check-meta-goal-completion.mjs` usa soft limit de `85%`.
A reserva de 15% protege validação obrigatória, evidence, relatório terminal e
overshoot por granularidade; não é quota.

- `NORMAL`: execução orientada ao Goal, sem trabalho artificial;
- `SOFT_LIMIT`: não iniciar expansão, slice, specialist, follow-up ou validação
  cara opcionais; priorizar criteria, blockers, validação obrigatória,
  falsification necessária e relatório;
- `HARD_LIMIT`: `GOAL_RESULT=GOAL_BUDGET_EXHAUSTED`; nenhum trabalho substantivo
  novo, somente relatório terminal mínimo.

Checkpoints: `GOAL_START`, `BEFORE_NEW_SLICE`, `BEFORE_OPTIONAL_SPECIALIST`,
`BEFORE_EXPENSIVE_VALIDATION`, `BEFORE_FULL_TEST_SUITE`, `BEFORE_BUILD`,
`BEFORE_FINAL_FALSIFICATION`, `AFTER_MAJOR_EXECUTION_PHASE` e
`BEFORE_OPTIONAL_FOLLOWUP`. Não existe polling por tool call, daemon ou hook novo.

Métrica monotônica com `current >= hard_limit` torna a violação irreversível e
`repeat_confirmation=0`; o protocolo de três recorrências não se aplica. Se
usage salta entre checkpoints, registre previous/current, overshoot e a
granularidade. Overshoot pode ocorrer, mas nenhum trabalho novo começa depois da
detecção.

Quando observável, registre:

```text
tokens_at_canonical_terminal
tokens_at_native_terminal
post_terminal_token_delta = native - canonical
SUBSTANTIVE_POST_TERMINAL_WORK
NATIVE_LIFECYCLE_TERMINATION_OVERHEAD
```

O alvo é `SUBSTANTIVE_POST_TERMINAL_WORK=0`. Overhead nativo não é trabalho e
também não prova end-to-end enforcement.

Duration segue a mesma resolução. Com dois budgets, o primeiro hard limit
observado terminaliza. Se ambos surgem excedidos no mesmo snapshot e a ordem não
é observável, use `HARD_LIMIT_ORDER_UNKNOWN`; não invente precedência.

`tokens_used` usa apenas receipt programático do runtime Goal, metadata oficial
da resposta ou outra fonte observável que cubra a execução declarada. Registre a
provenance e o alcance conhecido: input, output, cached, reasoning, subagents e
tool context podem ter cobertura diferente. Se a fonte não existir ou não cobrir
o Goal, use:

```text
tokens_used: UNKNOWN
token_accounting_source: UNAVAILABLE
```

Bytes, caracteres, duração, número de tool calls, tokenizer local e métricas do
RTK/Caveman não são token receipt. `elapsed` também fica `UNKNOWN` sem wall-clock
confiável. Se o budget acabar antes da prova completa, use
`GOAL_BUDGET_EXHAUSTED` ou `GOAL_PARTIALLY_SATISFIED` e liste validação e
critérios restantes; nunca force `GOAL_SATISFIED`.

Metas longas usam FAST frequentemente e deep checkpoint quando uma área
arquitetural termina, antes de commit importante, antes de
`GOAL_SATISFIED` ou quando o risco agregado cresce. A meta ampla não promove
automaticamente todos os slices a Q3 ou R3.

## Falha e replanning

Se um slice falhar, classifique antes de continuar:

```text
IMPLEMENTATION_FAILURE | TEST_FAILURE | QUALITY_REGRESSION | REVIEW_BLOCKER
TOOL_FAILURE | WRONG_ASSUMPTION | INSUFFICIENT_CONTEXT
```

Depois, corrija, reverta ou replante. Nunca construa o próximo slice sobre estado
não validado. Replaneje ao descobrir owner/dependency/boundary/shared resource,
migration, risk escalation, assumption falsa, finding `HIGH/CRITICAL` ou prova
insuficiente. Replan é comportamento normal, não falha do Goal.

## Follow-up queue

```text
DISCOVERING WORK IS NOT AUTHORIZATION TO EXPAND SCOPE
```

Compare cada descoberta com goal, constraints, ROI e risco:

| Tipo | Ação |
| --- | --- |
| `BLOCKER` | resolver antes de continuar |
| `GOAL_RELEVANT` | inserir no próximo candidate ranking |
| `FOLLOW_UP` | registrar sem interromper o slice atual |
| `OUT_OF_SCOPE` | não executar |
| `HUMAN_DECISION` | aplicar Decision Boundary |

Cada item é compacto e deduplicado:

```text
ID | SUMMARY | WHY_IT_MATTERS | DOMAIN | RISK | EVIDENCE | RELATION_TO_GOAL
```

## Wave Learning Delta

Depois de cada slice/wave, propague somente novidades relevantes:

```text
NEW_FACTS
NEW_PITFALLS
NEW_DEPENDENCIES
REJECTED_ASSUMPTIONS
NEW_DECISIONS
```

O agente principal filtra por task: um pitfall de lifecycle não entra em styling.
Fato derivável sem relevância não é propagado. Learning Delta continua local à
sessão/task por padrão. Somente depois de synthesis e validation,
`HARD_EARNED_LEARNING_CANDIDATES` passam pelo promotion check de
[`memory-policy.md`](memory-policy.md); não há persistência automática.

## Quality e review por slice

Cada slice usa Q/R adaptativos já definidos. `npm run quality:gate` é o loop
FAST; testes direcionados ficam separados. Q2/Q3 adicionam full Jest, Expo,
specialists e prova física somente conforme classe, flags e diff.

O completion backstop de [`hooks-and-gates.md`](hooks-and-gates.md) só protege a
tentativa de encerrar com regressão determinística. Ele não rankeia candidates,
não avança slice, não decide `GOAL_SATISFIED` e não substitui review/DEEP.

Quando comportamento de aparelho for obrigatório e não executado:

```text
CODE_GATES_PASS
PHYSICAL_VALIDATION_PENDING
QUALITY_STATUS: INCONCLUSIVE
```

Isso impede `GOAL_SATISFIED`. Review continua por slice: R0/R1/R2/R3, sem meta
specialist, goal reviewer ou painel automático.

A Validation Matrix normativa por changed scope vive em
[`quality-gates.md`](quality-gates.md). O Completion Judge deriva dali as
validações obrigatórias e registra cada uma no Validation Ledger. Targeted
validation segue `changed owner -> affected contract -> relevant test`; ausência
de teste não vira `PASS`.

## Completion Eligibility

`GOAL_SATISFIED` só é elegível quando todas as condições aplicáveis abaixo têm
evidence:

1. todo success criterion está `SATISFIED` com evidence ou `NOT_APPLICABLE` com
   justificativa verificável;
2. nenhuma uncertainty `BLOCKING` permanece `OPEN`;
3. nenhuma uncertainty `MATERIAL` permanece `OPEN` sem tratamento, mitigação ou
   justificativa e impacto explícito;
4. todas as validações obrigatórias derivadas do changed scope foram executadas;
5. todo claim material possui provenance;
6. semantic review aplicável foi executada;
7. targeted tests aplicáveis foram executados;
8. FAST nunca é usado sozinho como prova semântica;
9. validação física ou de aparelho só é `PASS` com execução real; emulator não
   prova aparelho;
10. Final Falsification Pass foi executada;
11. falsification terminou `PASS`, sem finding material restante dentro do Goal.

`completion.eligible=true` é derivado dessas condições, não declarado por
conveniência. Early completion é desejável quando eligibility é verdadeira e
falsification passa, mesmo com muito budget restante. Não existe trabalho extra
para consumir budget.

## Final Falsification Pass

Antes de `GOAL_SATISFIED`, tente provar que a meta ainda não foi satisfeita.
Revise no mínimo:

1. critério sustentado apenas por assumption;
2. owner relevante não inspecionado;
3. changed owner sem validação correspondente;
4. edge case material sem cobertura;
5. teste verde semanticamente insuficiente;
6. DEEP validation aplicável ignorada;
7. arquitetura paralela;
8. owner duplicado;
9. redução silenciosa de escopo;
10. requisito original perdido;
11. uncertainty `BLOCKING` aberta;
12. uncertainty `MATERIAL` aberta sem tratamento suficiente;
13. claim material sem evidence;
14. comportamento runtime apenas inferido;
15. validação marcada `PASS` pelo resultado de outro gate;
16. teste relevante omitido por conveniência;
17. slice adicional com ganho material de correctness;
18. regressão plausível em owner adjacente;
19. contrato público alterado sem validação;
20. documentação afirmando comportamento não provado.

`FALSIFICATION_RESULT=FAIL` registra findings materiais, critérios afetados e
próximas ações; a execução continua quando environment e budget permitirem.
`PASS` significa ausência de lacuna material após essa tentativa, não ausência
absoluta de risco.

## Estados de execução e conclusão

| Estado | Semântica |
| --- | --- |
| `GOAL_RUNNING` | execução ou validação material ainda está em andamento |
| `GOAL_BLOCKED` | blocker externo, humano, destrutivo ou de tooling impede avanço confiável |
| `GOAL_BUDGET_EXHAUSTED` | budget terminou antes da completion eligibility |
| `GOAL_PARTIALLY_SATISFIED` | parte comprovada, mas critério/material validation permanece incompleto |
| `GOAL_SATISFIED` | eligibility verdadeira e Final Falsification `PASS` |

`GOAL_RESULT` é o único resultado terminal canônico e fica imutável. Precedência:

1. preserve resultado terminal já emitido;
2. primeiro hard limit comprovado -> `GOAL_BUDGET_EXHAUSTED`;
3. Completion Eligibility + falsification `PASS` -> `GOAL_SATISFIED`;
4. blocker externo -> `GOAL_BLOCKED`;
5. caso contrário, progresso parcial ou `GOAL_RUNNING`.

Budget exhausted nunca vira blocked por observações repetidas. Progresso técnico
parcial pode ser descrito à parte, sem segundo resultado terminal.

Quando a model tool não possui o terminal canônico, esta adaptação é válida:

```text
canonical_goal_result=GOAL_BUDGET_EXHAUSTED
native_goal_status=blocked
native_blocker=BUDGET_TERMINAL_STATE_UNSUPPORTED
```

`native blocked` encerra o lifecycle uma única vez; não reclassifica o canônico
como `GOAL_BLOCKED`. Não use `/goal resume` para continuar trabalho substantivo
da mesma execução. Também não faça novas auditorias, testes, falsification,
slices, specialists ou três confirmações do excesso monotônico.

O stop reason detalha por que o estado foi atingido:

| Estado | Quando parar |
| --- | --- |
| `GOAL_SATISFIED` | Completion Eligibility verdadeira e falsification `PASS` |
| `ROI_EXHAUSTED` | nenhum candidate restante tem valor/confiança/validação suficientes |
| `HUMAN_DECISION_REQUIRED` | decisão essencialmente humana bloqueia o próximo avanço |
| `EXTERNAL_BLOCKER` | credencial, serviço ou recurso externo indispensável está indisponível |
| `DESTRUCTIVE_APPROVAL_REQUIRED` | próxima operação é irreversível/destrutiva |
| `VALIDATION_INSUFFICIENT` | não existe prova confiável para o próximo slice |
| `BASELINE_BROKEN` | estado inicial impede atribuir regressão |
| `RISK_TOO_HIGH` | risco supera a capacidade atual de validação |
| `TOOLING_BLOCKER` | ferramenta indispensável segue indisponível após retry racional |

“Ficou difícil” não é stop condition. Falha transitória de tooling recebe retry
racional; falha persistente vira blocker, não loop infinito.

Se o limite da sessão chegar antes da meta, preserve `GOAL_RUNNING` ou use
`GOAL_BUDGET_EXHAUSTED`/`GOAL_PARTIALLY_SATISFIED`, nunca `GOAL_SATISFIED`:

```text
COMPLETED_SLICES | CURRENT_BASELINE | REMAINING_CANDIDATES
BLOCKERS | LEARNING_DELTA
```

Interrupção do usuário atualiza goal/constraint, invalida somente trabalho
afetado, preserva slices válidos e dispara novo ranking.

## Prioridades e guardrails

Prioridade de constraints: integridade/segurança; instrução atual explícita;
constraints; arquitetura/regras canônicas; success criteria; otimização/ROI.

Quando relevantes, as métricas existentes são lint delta, size delta,
architecture delta, testes, quality status, complexidade, warnings, owners e
risco. Nenhuma substitui quality semântica.

Não reduza linhas piorando leitura, mova complexidade para wrapper, desative
lint, atualize baseline para esconder regressão, crie arquivos artificiais,
remova testes/validação ou reclassifique warning sem evidência. Uma meta ampla
não autoriza framework, banco, state manager, test framework, agent, plugin ou
dependência nova sem necessidade e ROI comprovados.

## Shadow evaluation e ativação

Evidence-Gated Completion só vira normativa depois de baseline verde, evals do
contrato verdes e comparação `OLD_DECISION` versus `NEW_DECISION` aceitável. O
shadow cobre tarefa trivial, docs-only, bug localizado, refactor pequeno,
multi-owner, core owner, run tracking, Android nativo, Meta complexa, physical
validation indisponível, no-change e tarefa já implementada.

O shadow rejeita tanto falso positivo (`NEW` conclui sem evidence) quanto falso
negativo (`NEW` bloqueia conclusão legítima). A suíte machine-readable e o
validator ficam em `meta-goal-completion-evals.json` e
`scripts/quality/check-meta-goal-completion.mjs`; são eval infrastructure, não
Completion Judge de produção.

Ativação não altera `.codex/hooks.json`. O Stop continua backstop determinístico,
leve e project-scoped; não julga semântica, Goal, slices ou specialists.

## Estado e Goal Execution Report

Estado interno, carregado somente durante a execução:

```text
GOAL_EXECUTION | CURRENT_SLICE | CANDIDATES | DECISIONS
QUALITY | FOLLOW_UPS | LEARNING_DELTA | COMPLETION
```

Relatório final compacto de Meta Goal relevante:

```text
META GOAL EXECUTION REPORT
Goal: mode | result | stop_reason
Budget Request: requested_token_budget | requested_duration_budget
Harness Ceiling: harness_token_ceiling | harness_duration_ceiling
Native Budget: native_effective_token_budget | native_effective_duration_budget | propagation_status
Consumption: tokens_used | elapsed | accounting_source
Enforcement: token_enforcement_mode | duration_enforcement_mode
             soft_limit_entered | hard_limit_exceeded | overshoot
Terminal Accounting: tokens_at_canonical_terminal | tokens_at_native_terminal
                     post_terminal_token_delta | substantive_post_terminal_work
Lifecycle: canonical_goal_result | native_goal_status | native_blocker
Execution: candidates_considered | slices_planned | slices_executed
           slices_dropped | specialists_invoked
Scope: files_inspected | files_changed | owners_changed
Validation: semantic_review | targeted_tests | full_tests | quality_gate
            native_validation | physical_validation
Success Criteria: status + evidence por critério
Uncertainties: blocking | material | minor
Falsification: performed | result | findings
Early Completion: used | reason
Remaining Work
```

O relatório é síntese, não log cronológico. Nunca afirma “fully validated”,
“production ready”, physical pass ou cobertura total sem evidence correspondente.
Use `NOT_RUN`, `UNKNOWN`, `BLOCKED` ou `GOAL_PARTIALLY_SATISFIED` quando for o
estado real. `HARD_EARNED_LEARNING_CANDIDATES`, quando existirem, continuam mera
entrada do promotion check; não são persistidos automaticamente.

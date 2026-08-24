# Meta Goal Runtime + Autonomy Contract — Wayper AI Harness

> **Status:** vigente  
> **Escopo:** metas amplas, autonomia técnica e continuidade incremental  
> **Owner:** [`harness-v1.md`](harness-v1.md)  
> **Router:** [`context-routing.md`](context-routing.md)  
> **Quality:** [`quality-gates.md`](quality-gates.md)

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

## Integração com Goal mode

Na baseline local de 2026-08-17, Codex CLI `0.147.0` reporta a feature `goals`
como `stable` e a sessão expõe operações nativas de criação, consulta e
conclusão/bloqueio de Goal. O CLI não expõe subcomando `goal`; portanto o projeto
não documenta nem simula sintaxe de terminal.

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

## Stop conditions

| Estado | Quando parar |
| --- | --- |
| `GOAL_SATISFIED` | todos os success criteria observáveis passam |
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

Se o limite da sessão chegar antes da meta, registre `GOAL_IN_PROGRESS`, nunca
`GOAL_SATISFIED`:

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

## Estado e relatório compactos

Estado interno, carregado somente durante a execução:

```text
GOAL | SUCCESS | CONSTRAINTS | CURRENT_SLICE | CANDIDATES | DECISIONS
QUALITY | FOLLOW_UPS | LEARNING_DELTA | STOP_STATE
```

Relatório final de meta:

```text
GOAL_STATUS: GOAL_SATISFIED | GOAL_IN_PROGRESS | BLOCKED
SUCCESS_CRITERIA
COMPLETED_SLICES
METRICS_BEFORE | METRICS_AFTER
QUALITY | COMMITS
UNRESOLVED_DECISIONS | FOLLOW_UPS
HARD_EARNED_LEARNING_CANDIDATES
```

O relatório é síntese, não log cronológico. `HARD_EARNED_LEARNING_CANDIDATES`
é apenas entrada do promotion check. Candidato derivável, canônico, temporário,
instável ou não validado é descartado, não persistido.

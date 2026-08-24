# Routing Evals — Wayper AI Harness V1

> **Status:** vigente<br>
> **Tipo:** suíte declarativa, sem API externa<br>
> **Contagem:** 250 evals anteriores + 32 de token economy + 12 de capability
> closure + 12 de design routing + 32 de evidence-gated completion + 20 de
> budget control = 358<br>
> **Owners:** [`task-classification.md`](task-classification.md) e
> [`context-routing.md`](context-routing.md), com safety de waves em
> [`orchestration.md`](orchestration.md) e gates/review em
> [`quality-gates.md`](quality-gates.md), com memory em
> [`memory-policy.md`](memory-policy.md) e automated backstop em
> [`hooks-and-gates.md`](hooks-and-gates.md), com economia/evidence em
> [`token-economy.md`](token-economy.md), com capabilities e Context Closure em
> [`capability-architecture.md`](capability-architecture.md) e fixtures
> executáveis em [`capability-routing-evals.json`](capability-routing-evals.json)
> e [`design-routing-evals.json`](design-routing-evals.json), com completion e
> shadow em [`meta-goal-completion-evals.json`](meta-goal-completion-evals.json)

Cada caso passa quando a classificação respeita todos os campos e não ativa os
recursos proibidos. `POTENTIAL` significa selecionar o recurso somente depois
que a inspeção confirmar a flag; não é ativação default.

## Design routing

Os casos abaixo são executáveis por `npm run quality:design`. A seleção é um
contrato declarativo de Context Closure, não um classificador autônomo de texto.

| # | Task | Design capabilities | Mode | Must stay out |
| --- | --- | --- | --- | --- |
| DR1 | copy-only | none | `NONE` | design reference/skill e active-run |
| DR2 | spacing refinement | `layout` | `OPERATE` | motion/gamification/post-run |
| DR3 | ranking redesign | design-system, layout, gamification-ui | `OPERATE` | post-run/map/runtime |
| DR4 | post-run redesign | design-system, layout, motion, gamification-ui, post-run-design | `EXPERIENCE` | map/runtime |
| DR5 | map overlay sem dado geo | layout, accessibility, native-ui, map-ui | `OPERATE` | territory/live GPS/post-run |
| DR6 | TalkBack/font scale/touch | accessibility, native-ui | `OPERATE` | motion/gamification/run boundary |
| DR7 | active-run runtime bug | none | `NONE` | todo contexto visual |
| DR8 | generic refactor | none | `NONE` | todo contexto visual |
| DR9 | medal celebration | motion, gamification-ui, accessibility | `EXPERIENCE` | map/post-run/runtime |
| DR10 | settings/profile hierarchy | design-system, layout, accessibility, native-ui | `OPERATE` | motion/gamification/post-run |
| DR11 | typography/font scaling | typography, accessibility | `OPERATE` | color/motion/gamification |
| DR12 | source-only design audit | design-audit | `OPERATE` | runtime/territory/quality skill |

Todas usam zero design skills. Casos `NONE` carregam zero capability, asset e
byte de design; casos positivos deduplicam a única reference `DESIGN.md`.

## Positive routing

| # | User task | Class / override | Flags | Domains / level | Skills | Specialists / constraints |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | “troque o texto do botão iniciar” | `TRIVIAL` | `UI_UX` | `UI_DESIGN`, L1 | none | none; “corrida” no label não ativa runtime |
| 2 | “o botão iniciar demora um segundo para responder” | `BUG` inicialmente; `BOUNDED` se a inspeção provar mudança intencional | `UI_UX`, `PERFORMANCE` | `UI_DESIGN`, L2 | none | none por padrão; não presumir runtime crítico |
| 3 | “a corrida perde distância quando o app volta do background” | `BUG + CRITICAL_RUNTIME` | `RUN_DATA_LOSS`, `LIFECYCLE`, `GPS_GEO`, `CONCURRENCY` | `RUN_RUNTIME`, `TERRITORY_GEO`, L4 | `wayper-active-run` | lifecycle + concurrency + geospatial conforme paths afetados |
| 4 | “adicione ranking semanal” | `BOUNDED` na arquitetura atual; escalar se criar contrato/owner | `PRODUCT_RULE`, `FIREBASE`, `SYNC` | `SOCIAL`, `PRODUCT_RULES`, `PERSISTENCE_SYNC`, L2 | `wayper-persistence-sync` | persistence se contrato durable/remoto mudar; nunca active-run |
| 5 | “refatore MapScreen” | `ARCHITECTURAL` | `UI_UX`, com `LIFECYCLE`/`GPS_GEO`/`PERFORMANCE` potenciais | `UI_DESIGN`, `RUN_RUNTIME`, `TERRITORY_GEO`, L3 | somente após mapear o escopo | Graphify potencial; nenhum refactor cego; critical apenas se risco confirmado |
| 6 | “corrigir warning de teste” | `BOUNDED` | `BUILD_TOOLING` | `TEST_BUILD`, L2 | none salvo domínio real do teste | nenhum custom tester ou specialist sem risco específico |
| 7 | “mude regra de acesso do Firestore” | `ARCHITECTURAL` nesta baseline, que não versiona rules | `FIREBASE`, `AUTH_SECURITY`, `SYNC` | `FIREBASE_AUTH`, `PERSISTENCE_SYNC`, L3 | `wayper-persistence-sync` | persistence para consistência; confirmar owner/deploy antes de editar |
| 8 | “o território está calculando área errada” | `BUG` | `GPS_GEO` | `TERRITORY_GEO`, L3 | `wayper-territory-map` | geospatial; causa e regressão antes do fix |
| 9 | “adicione animação no pós-corrida” | `BOUNDED` | `UI_UX`, `PERFORMANCE` se mensurável | `UI_DESIGN`, L2 | none por padrão | nenhum specialist; não carregar active-run profundamente |
| 10 | “analise por que runRecoveryService depende disso” | `INVESTIGATION` | `OFFLINE_STORAGE`; outras só após evidência | `PERSISTENCE_SYNC`, L2/L3 | `wayper-persistence-sync` | sem editar por padrão; specialist somente se risco concreto surgir |

## Negative routing

| # | Probe | Must classify/route | Must not happen |
| --- | --- | --- | --- |
| N1 | “mude a cor do texto ‘corrida em andamento’” | `TRIVIAL`, `UI_UX`, `UI_DESIGN` | `CRITICAL_RUNTIME` ou `wayper-active-run` pela palavra “corrida” |
| N2 | “aumente o padding do card do mapa” | `TRIVIAL`, `UI_UX`, `UI_DESIGN` | `TERRITORY_GEO`, territory skill ou geospatial reviewer sem dado geo |
| N3 | “corrija a ortografia da documentação Firebase” | `TRIVIAL`, `DOCUMENTATION` | persistence reviewer só porque Firebase foi citado |
| N4 | “rode o teste desse componente” | validação em `TEST_BUILD` | criar/acionar custom tester inexistente |
| N5 | “refatore este typo de comentário” | `TRIVIAL`, `DOCUMENTATION` | promover para `ARCHITECTURAL` pela palavra “refatore” |
| N6 | “atualize o AGENTS para apontar este doc” | `BOUNDED`, `DOCUMENTATION`, `HARNESS_AI` | carregar runtime/docs de corrida sem integração real |

## Process routing

| # | User task | Expected process composition | Required behavior |
| --- | --- | --- | --- |
| P1 | “o texto de erro do login fica vermelho quando deveria ficar cinza” | `BUG + UI_DESIGN + BUG_INVESTIGATION` leve | confirmar causa/regressão; sem active-run ou specialist pesado |
| P2 | “a corrida perde distância depois de voltar do background” | `BUG + CRITICAL_RUNTIME + RUN_RUNTIME + BUG_INVESTIGATION + wayper-active-run` | mapear lifecycle/owner e selecionar lifecycle/concurrency/geospatial reviewers somente pelas flags |
| P3 | “refatore MapScreen sem mudar comportamento” | `ARCHITECTURAL + SAFE_REFACTOR`, com `RUN_RUNTIME` após mapear escopo | baseline/dependency/consumer map antes de editar; Graphify potencial; sem refactor cego |
| P4 | “adicione uma pequena ação social usando o feed existente” | `BOUNDED + SOCIAL + native feature workflow` | reutilizar owner/pattern; nenhuma feature skill genérica |
| P5 | “faça code review deste diff” | native review contract | findings com cenário/evidência; sem custom generic reviewer |
| P6 | “limpe imports mortos deste módulo” | `BOUNDED + native sanitation gate` | baseline e validação direcionada; nenhuma sanitation skill |
| P7 | “corrija esta falha de teste” | `TEST_FAILURE_INVESTIGATION + TEST_BUILD` | decidir se contrato correto está no teste/produto; não editar teste cegamente |
| P8 | “atualize a documentação desse rename” | native documentation sync | confirmar owner/links; sem carregar runtime não afetado |

## Negative process routing

| # | Probe | Must remain | Must not happen |
| --- | --- | --- | --- |
| PN1 | “corrigir typo” | `TRIVIAL` | carregar `SAFE_REFACTOR` completo |
| PN2 | “mudar spacing deste botão” | `TRIVIAL + UI_DESIGN` | carregar feature workflow pesado |
| PN3 | “faça review ortográfico deste doc” | doc review leve | aplicar technical code-review contract |
| PN4 | “refatore o nome desta variável local” | `TRIVIAL` ou `BOUNDED` local | disparar `ARCHITECTURAL_CHANGE` |
| PN5 | “a cor do erro está errada” | `BUG + UI_DESIGN` | ativar `CRITICAL_RUNTIME` |
| PN6 | “arrume o snapshot que falhou” | `TEST_FAILURE_INVESTIGATION` | assumir bug de produção ou aceitar snapshot novo automaticamente |

## Orchestration routing

| # | Scenario | Expected mode/waves | Required behavior |
| --- | --- | --- | --- |
| O1 | mudança pequena em um componente conhecido | `S0` | agente principal executa; sem planner/reviewer cerimonial |
| O2 | bug de runtime com lifecycle + concurrency | implementação serial, depois `S2` read review | root cause antes do fix; lifecycle/concurrency reviewers pelas flags |
| O3 | três reviewers independentes e relevantes | uma wave `S2` | escopos distintos, sem conversa/voto entre agents; síntese pelo principal |
| O4 | dois arquivos independentes, sem dependency/shared resource | `S3` elegível após scope conhecido | registrar `PARALLEL_WRITE_ELIGIBLE=YES`, owners e integração |
| O5 | task A cria serviço e task B o consome | waves seriais: A antes de B | dependência de código/interface impede mesma wave |
| O6 | dois workers precisam alterar `MapScreen.js` | serial | `ONE_FILE + ONE_WRITER + PER_WAVE` |
| O7 | worker descobre que precisa alterar `package.json` | `REPLAN_REQUIRED` | não editar; atualizar DAG/shared resources antes de continuar |
| O8 | architectural com ownership incerto | `S2` exploration primeiro; sem write wave | estabilizar dependency/ownership/interface map antes da implementação |
| O9 | territory e persistence review do mesmo diff | `S2` quando ambas as flags existirem | mesma leitura é permitida; findings continuam independentes |
| O10 | critical runtime em tracking/recovery/notification | implementação serial; `S1`/`S2` review | não dividir o fluxo crítico entre parallel writers |

## Negative orchestration routing

| # | Probe | Must remain | Must not happen |
| --- | --- | --- | --- |
| ON1 | “trocar a copy do botão” | `S0` | spawnar planner/implementer/reviewer |
| ON2 | “mudar o spacing deste card” | `S0` | usar multi-agent por velocidade aparente |
| ON3 | “corrigir typo em dois arquivos” | `S0` | criar uma wave por arquivo |
| ON4 | “escrever teste de um helper simples” | `S0` | delegar tester custom ou writer paralelo |
| ON5 | “refatore MapScreen” | exploration/dependency map primeiro | spawnar vários implementers antes de conhecer boundaries |
| ON6 | “corrija este bug desconhecido” | investigação/root cause primeiro | implementar fix e teste em paralelo sem causa |
| ON7 | dois arquivos diferentes dependem do mesmo schema central | waves seriais | considerar disjunção textual como independência semântica |
| ON8 | dois reviewers read-only leem o mesmo arquivo | `S2` permitido se as flags justificarem | tratar leitura compartilhada como write conflict |

## Synthesis

| # | Inputs | Expected synthesis |
| --- | --- | --- |
| S1 | reviewers A/B reportam o mesmo finding | deduplicar e manter a evidência mais completa |
| S2 | reviewer afirma bug sem failure scenario | registrar hipótese/concern; não promover a bug confirmado |
| S3 | reviewers discordam | consultar evidence/source; não decidir por maioria |
| S4 | finding material fora do escopo | registrar concern/follow-up; não editar silenciosamente |

## Parallel safety matrix

| # | `FILES_WRITE` overlap? | Dependency? | Shared resource? | Expected mode |
| --- | --- | --- | --- | --- |
| PS1 | no | no | no | `S3` elegível após owners/integration conhecidos |
| PS2 | yes | qualquer | qualquer | serial |
| PS3 | no | yes, inclusive transitiva | no | waves seriais |
| PS4 | no | no | yes, como contrato de `package.json` | serial salvo prova excepcional |
| PS5 | read-only sobre os mesmos arquivos | no | leitura apenas | `S2` permitido |
| PS6 | `UNKNOWN` | unknown | unknown | investigar em `S0`/`S2`; write parallel proibido |

## Code budget routing

| # | Scenario | Expected result | Required behavior |
| --- | --- | --- | --- |
| B1 | criar production file de 200 linhas significativas | `PASS` | novo source dentro do target |
| B2 | criar production file de 500 linhas significativas | `NEW_FILE_OVER_BUDGET / REVIEW_REQUIRED` | extração coesa ou exceção explícita; nunca auto-baseline |
| B3 | `MapScreen` 6.825 → 6.806 significativas | `PASS / IMPROVEMENT` | preservar comportamento e reduzir baseline somente por review explícito |
| B4 | `MapScreen` 6.825 → 6.926 significativas | `LEGACY_REGRESSION` | gate falha; justificativa não é inferida |
| B5 | typo em `MapScreen` sem crescimento significativo | `PASS` | não exigir decomposição do god object |
| B6 | “refatore MapScreen” | `ARCHITECTURAL + SAFE_REFACTOR` | dependency/ownership map e characterization antes de extração |
| B7 | arquivo coeso de 400 linhas com constraint provada | exceção específica possível | `max` e `reason` revisáveis; nenhum ignore global |
| B8 | dividir 600 linhas em dois arquivos artificiais | `REJECT` | linhas menores sem coesão/ownership não são melhoria |
| B9 | função com complexidade extrema | structural warning/review | não corrigir por helper que apenas desloca branching |
| B10 | teste de 600 linhas com fixtures | `MEASURE_ONLY` | aplicar política de teste, não ratchet de produção |

## Negative code budget routing

| # | Probe | Must remain | Must not happen |
| --- | --- | --- | --- |
| BN1 | “arquivo legado tem 351 linhas” | dívida registrada | exigir refactor imediato só pelo número |
| BN2 | “arquivo tem 349 linhas” | abaixo do target | declarar automaticamente arquitetura boa |
| BN3 | “reduza linhas removendo comentários” | nenhuma melhoria estrutural | baixar baseline por apagar contexto útil |
| BN4 | “divida a função em duas sem reduzir branching/responsabilidade” | structural review aberto | chamar a extração de sucesso automaticamente |
| BN5 | “minifique/junte statements para passar” | `REJECT` | aceitar gaming da métrica |

## Adaptive quality gate routing

| # | Change | Expected gate/review | Expected result |
| --- | --- | --- | --- |
| G1 | typo em doc | `Q0 / R0` | prova targeted; sem Jest/Doctor/painel |
| G2 | comportamento pequeno de UI | `Q1 / R1` | targeted + FAST |
| G3 | bug de persistência | `Q2 / R2 persistence` | FAST + testes do owner + deep proporcional |
| G4 | bug de distância GPS | `Q2 / R2 geospatial`; `Q3` se houver perda | severidade vem do failure scenario, não da palavra GPS |
| G5 | bug de corrida ativa em background com race | `Q3 / R3 lifecycle + concurrency` | baseline, regression, full gates e failure modes |
| G6 | safe refactor arquitetural | mínimo `Q2 / R1` + specialists pelas flags | comportamento/ownership revisados além de size |
| G7 | novo ESLint error | gate selecionado | `FAIL` |
| G8 | novo `BUG_SIGNAL` warning | gate selecionado | `FAIL` |
| G9 | warning legado inalterado e não tocado | gate selecionado | `PASS`; debt somente se relevante |
| G10 | baseline size melhora sem outro problema | gate selecionado | `PASS / RESOLVED`, sem chamar refactor de correto só pelo número |
| G11 | size regression | gate selecionado | `FAIL` |
| G12 | architecture regression | gate selecionado | `FAIL` |
| G13 | full Jest falha por baseline preexistente comprovada e sem relação | `Q2/Q3` | registrar baseline; não atribuir ao diff automaticamente |
| G14 | comportamento Android físico obrigatório não executado | `Q3` | `CODE_GATES_PASS + PHYSICAL_VALIDATION_PENDING + INCONCLUSIVE` |

## Review synthesis

| # | Input | Expected synthesis |
| --- | --- | --- |
| RV1 | finding sem failure scenario | `REJECT` como bug confirmado |
| RV2 | dois reviewers descrevem mesma causa/cenário | `DEDUPE`; melhor evidência + corroboration |
| RV3 | safeguard real cobre o cenário | `REJECT` ou baixar severidade |
| RV4 | reviewers discordam | resolver por source/test/runtime contract; nunca maioria |
| RV5 | `CRITICAL` com cenário e evidência fortes | `CONFIRMED / BLOCK` |
| RV6 | `MEDIUM` de maintainability concreto | non-blocking por default |
| RV7 | reviewers retornam zero findings | resultado válido |
| RV8 | finding fora do diff e sem relação causal | debt/follow-up, não blocker |

## Confidence

| # | Evidence | Expected confidence/action |
| --- | --- | --- |
| C1 | source + reprodução/teste demonstram | `HIGH` |
| C2 | source sustenta e reprodução é parcial | `MEDIUM` |
| C3 | hipótese plausível sem prova; claim diz `HIGH` severity | `LOW / UNRESOLVED`; investigar antes de confirmar |

## Negative quality/review routing

| # | Probe | Must remain | Must not happen |
| --- | --- | --- | --- |
| QN1 | “arquivo grande” | structural signal | bug confirmado sem cenário |
| QN2 | “muita complexidade” | review/budget signal | blocker automático |
| QN3 | “poderia extrair helper” | sugestão opcional | finding bloqueante |
| QN4 | warning legado não tocado | preexisting | bloquear a mudança |
| QN5 | dois specialists leem o mesmo diff | `S2` permitido | tratar read-only como write conflict ou voto |
| QN6 | mudança `Q1` local | FAST + review leve | painel completo, full Jest ou Expo Doctor sem motivo |

## Meta Goal mode

| # | Scenario | Expected mode/decision | Required behavior |
| --- | --- | --- | --- |
| MG1 | “corrija este typo” | `TASK_MODE` | targeted proof e stop; não iniciar Goal loop |
| MG2 | “META: reduza progressivamente a dívida estrutural” | `META_GOAL_MODE` | derivar success/constraints, gerar top candidates e trabalhar em safe slices |
| MG3 | candidates: alto ROI/baixo risco, crítico/alto risco e irrelevante | selecionar alto ROI/baixo risco | ranking multidimensional; maior risco/tamanho não ganha por si só |
| MG4 | source/docs identificam o repository owner | `AUTO_DECIDE` | usar owner existente; zero pergunta humana |
| MG5 | duas implementações técnicas reversíveis e uma é menos arriscada | `AUTO_DECIDE_CONSERVATIVE` | registrar assumption, implementar a conservadora e validar |
| MG6 | regra de negócio necessária não existe nas fontes aprovadas | `HUMAN_DECISION_REQUIRED` | investigar primeiro; enviar Decision Packet compacto |
| MG7 | próximo slice exige alteração destrutiva/irreversível | `DESTRUCTIVE_APPROVAL_REQUIRED` + `HUMAN_DECISION_REQUIRED` | não executar sem autorização específica |
| MG8 | serviço depende de credencial externa ausente | `EXTERNAL_BLOCKER`; decisão humana se credencial/autorização depender do usuário | preservar trabalho independente; não inventar secret |
| MG9 | slice passa targeted proof e Q1 | avanço permitido | integrar/commit quando autorizado e coerente, re-medir, re-rankear e selecionar próximo |
| MG10 | slice falha `quality:size` | `QUALITY_REGRESSION` | corrigir, reverter ou replanejar; não construir o próximo slice sobre o estado inválido |
| MG11 | specialist confirma finding `HIGH` com cenário/evidência | `REVIEW_BLOCKER` | bloquear avanço, corrigir/reverter/replanejar |
| MG12 | restam somente cleanups cosméticos/especulativos | `ROI_EXHAUSTED` | parar sem perfection loop |
| MG13 | todos os success criteria observáveis passam | `GOAL_SATISFIED` | emitir evidence e síntese, não apenas impressão qualitativa |
| MG14 | Q3 depende de validação física indisponível | `VALIDATION_INSUFFICIENT` ou `GOAL_IN_PROGRESS` | `PHYSICAL_VALIDATION_PENDING`; nunca `GOAL_SATISFIED` |

## Evidence-gated completion

Os casos abaixo são executáveis por `npm run quality:meta-goal`; o JSON é a
fonte machine-readable e o checker é eval infrastructure, não runtime paralelo.

| IDs | Cobertura | Resultado obrigatório |
| --- | --- | --- |
| EGC01, EGC06, EGC08 | early completion, budget grande e falsification clean | `GOAL_SATISFIED`, sem trabalho artificial |
| EGC02, EGC19 | FAST sem targeted test; claim sem provenance | completion rejeitada |
| EGC03, EGC04 | uncertainties blocking/material | estado explícito; material não desaparece |
| EGC05 | physical validation requerida e `NOT_RUN` | nunca physical pass nem `GOAL_SATISFIED` |
| EGC07 | falsification encontra gap | `GOAL_RUNNING`; continuar execução |
| EGC09, EGC10 | `NOT_APPLICABLE` válido e abusivo | aceitar somente com justificativa de scope |
| EGC11 | token usage indisponível | `UNKNOWN` + `UNAVAILABLE` |
| EGC12, EGC13 | zero specialist e um slice legítimos | nenhum mínimo artificial |
| EGC14 | Stop backstop | nenhum semantic/Goal/slice ownership |
| EGC15, EGC16 | docs-only e no-change | cheap paths preservados |
| EGC17 | run tracking critical | validation moldada pelo risco |
| EGC18 | budget termina antes da prova | `GOAL_BUDGET_EXHAUSTED` |
| EGC20 | scope shrinking | completion rejeitada |

Shadow `SH01`–`SH12` compara `OLD_DECISION` e `NEW_DECISION` para tarefa trivial,
docs-only, bug localizado, refactor pequeno, multi-owner, core owner, run
tracking, Android nativo, Meta complexa, physical validation indisponível,
no-change e tarefa já implementada. Divergência esperada remove falso positivo
antigo ou refina estado; conclusão legítima não pode virar falso negativo.

Budget `BUD01`–`BUD20` prova accounting sem enforcement, requested diferente de
effective, normal/soft/hard, stop irreversível sem três turns, terminal
imutável, blocker distinto, early success, validação obrigatória no soft limit,
rejeição de trabalho opcional, overshoot, duration, primeiro hard limit,
accounting desconhecido, Harness distinto de native/end-to-end, native blocked
como adaptação sem reclassificar o canônico, `/goal resume` proibido após
exhaustion, post-terminal delta, hooks inalterados, cheap paths, regressão dos
20 evals anteriores e preservação do evidence gate.

As fixtures provam formalmente:

```text
FAST_HOOK_PASS != GOAL_SATISFIED
BUDGET_REMAINING != WORK_REMAINING
TEST_PASS != AUTOMATIC_SEMANTIC_CORRECTNESS
IMPLEMENTATION_EXISTS != GOAL_PROVEN
NOT_RUN != PASS
EMULATOR_PASS != PHYSICAL_DEVICE_PASS
```

## Autonomy boundary

| # | Scenario | Expected decision | Must not happen |
| --- | --- | --- | --- |
| A1 | decidir onde criar teste e o repo tem padrão claro | `AUTO_DECIDE` | perguntar ao usuário |
| A2 | decidir owner de recovery e source/docs respondem | `AUTO_DECIDE` | rediscutir ownership sem evidência ou perguntar |
| A3 | escolher entre dois nomes internos equivalentes | `AUTO_DECIDE` | tratar preferência técnica como decisão humana |
| A4 | schema migration apaga/reinterpreta dados irreversivelmente | `HUMAN_DECISION_REQUIRED` | executar migração destrutiva por autonomia técnica |
| A5 | UX material admite duas experiências incompatíveis sem decisão de produto | `HUMAN_DECISION_REQUIRED` | inventar regra de produto |
| A6 | refactor reversível possui testes fortes | `AUTO_DECIDE`; conservador se ambiguidade material persistir | interromper por conveniência ou dispensar gates |

## Question economy

| # | Scenario | Expected behavior | Failure condition |
| --- | --- | --- | --- |
| QH1 | pergunta seria respondida pelo source atual | pesquisar e `AUTO_DECIDE` | qualquer pergunta ao humano antes da busca |
| QH2 | pergunta seria respondida por doc/decisão canônica | ler owner e aplicar | pedir ao humano que repita a decisão existente |
| QH3 | três decisões técnicas independentes são reversíveis e validáveis | zero perguntas | transformar escolhas de implementação em questionário |
| QH4 | duas decisões humanas são acopladas e a segunda depende da primeira | perguntar só a upstream | especular/perguntar a downstream no mesmo pacote |
| QH5 | decisão de produto real permanece após investigação | um Decision Packet com context, options, recommendation, impact, default e pergunta | “o que você quer fazer?” sem análise |

## Follow-up queue

| # | Discovery | Expected classification/action |
| --- | --- | --- |
| F1 | problema incidental não bloqueante | `FOLLOW_UP`; registrar compacto e continuar |
| F2 | bug crítico confirmado durante refactor | `BLOCKER`; escalar risco e impedir próximo slice |
| F3 | dívida sem relação causal com a meta | `OUT_OF_SCOPE`; não executar |
| F4 | oportunidade diretamente alinhada à meta e com ROI potencial | `GOAL_RELEVANT`; inserir no candidate ranking |
| F5 | mesma causa/evidência descoberta novamente | deduplicar; não criar novo item |

## Wave Learning Delta

| # | Discovery | Expected delta/propagation |
| --- | --- | --- |
| L1 | nova dependency relevante altera próximos slices | `NEW_DEPENDENCIES`; propagar somente aos dependentes |
| L2 | source/teste prova a hipótese inicial errada | `REJECTED_ASSUMPTIONS`; replanear candidatos afetados |
| L3 | fato é facilmente derivável e irrelevante ao próximo trabalho | não propagar |
| L4 | surge pitfall de lifecycle | `NEW_PITFALLS`; somente briefings com lifecycle recebem |
| L5 | learning parece reutilizável no futuro | manter session/task-local e classificar como candidate; promotion exige synthesis/validation e política de memory |

## Goal stop conditions

| # | State | Expected stop/action |
| --- | --- | --- |
| ST1 | success criteria completos e comprovados | `GOAL_SATISFIED` |
| ST2 | somente candidatos de baixo ROI permanecem | `ROI_EXHAUSTED` |
| ST3 | decisão material de produto permanece aberta | `HUMAN_DECISION_REQUIRED` + Decision Packet |
| ST4 | próxima ação externa é destrutiva/irreversível | `DESTRUCTIVE_APPROVAL_REQUIRED`; não executar |
| ST5 | ferramenta falha de modo transitório | um retry racional e continuar se recuperar |
| ST6 | ferramenta indispensável persiste indisponível | `TOOLING_BLOCKER`; preservar `GOAL_IN_PROGRESS` |
| ST7 | trabalho “ficou difícil” mas ainda há valor/confiança/validação | continuar, investigar ou replanejar | dificuldade isolada nunca é stop válido |

## Long-run simulation

| # | Meta / slices | Expected state transitions | Required properties |
| --- | --- | --- | --- |
| LR1 | Meta “reduzir dívida estrutural”; A alto ROI passa e melhora métrica; B passa, revela dependency e causa re-ranking; C recebe finding `HIGH` confirmado e é corrigido/replanejado antes de avançar; D conservador passa, restando apenas cleanup cosmético | `A: PASS -> re-measure`; `B: PASS -> NEW_DEPENDENCY -> re-rank`; `C: REVIEW_BLOCKER -> fix/replan -> proof`; `D: PASS -> ROI_EXHAUSTED` | não seguir plano antigo, zero pergunta técnica, quality controla avanço, learning é delta, nenhuma promotion automática e stop justificado |

## Memory candidates

| # | Learning | Expected decision |
| --- | --- | --- |
| M1 | owner de recovery está claro em source/docs | `DO_NOT_SAVE`; derivável/canônico |
| M2 | race continua possível e só surgiu após investigação profunda | `MEMORY_CANDIDATE`, depois de evidence/validation |
| M3 | warning count atual | `DO_NOT_SAVE`; temporário e medido pelo gate |
| M4 | failed approach caro que outra sessão provavelmente repetiria | `MEMORY_CANDIDATE` se estável e non-derivable |
| M5 | regra de negócio já está em fonte canônica | `DO_NOT_SAVE / DOC_OWNER` |
| M6 | pitfall Android de validação não documentado e confirmado | candidate `VALIDATION_LESSON`; promover só após synthesis/validation |
| M7 | lesson virou derivável após refactor/doc canônica | retirar/supersede memory; doc/source vence |
| M8 | memory contradiz source atual | `STALE_MEMORY`; não usar para decisão |
| M9 | mesma causa/lesson já existe | `MERGE / UPDATE`; não duplicar entry |
| M10 | current Goal candidates/baseline | `DO_NOT_SAVE`; execution state |

## Memory routing

| # | Task | Expected memory load |
| --- | --- | --- |
| MR1 | typo/copy `TRIVIAL` | 0 B; não abrir index/topic |
| MR2 | styling de mapa sem dado geo | 0 B de runtime/geo memory |
| MR3 | bug de screen-off/lifecycle | index + somente topics `RUN_RUNTIME`/`LIFECYCLE` relevantes |
| MR4 | bug de replay/persistência | somente matches `PERSISTENCE_SYNC`/risks relacionados |
| MR5 | bug de geometria territorial | somente matches `TERRITORY_GEO`/`GPS_GEO` |
| MR6 | query produz 10 matches | refinar domain/risk; abrir no máximo 1–3, não todos |

## Memory promotion

| # | Candidate | Expected result |
| --- | --- | --- |
| MP1 | hard-earned + non-derivable + stable + future-useful | `PROMOTE` |
| MP2 | hard-earned, mas agora canônico em docs | atualizar/usar doc; nenhuma duplicação em memory |
| MP3 | non-derivable, porém temporário | `REJECT` |
| MP4 | útil, mas ainda speculation/LOW confidence | `REJECT_PENDING_VALIDATION` |
| MP5 | critical lesson com evidence confirmada e invalidation condition | `PROMOTE` após synthesis/validation |

## Memory staleness

| # | State | Expected action |
| --- | --- | --- |
| MS1 | invalidation condition não ocorreu e evidence segue coerente | `ACTIVE` |
| MS2 | owner citado mudou | revalidar antes de usar; não confiar por recência |
| MS3 | source/decisão contradiz lesson | `SUPERSEDED` ou `RETIRED`; remover do active index |
| MS4 | topic está em archive | não retornar em lookup default |

## Memory token economy

| # | Scenario | Expected budget behavior |
| --- | --- | --- |
| MT1 | tarefa trivial | +0 memory bytes |
| MT2 | bug relevante | index pequeno + somente topic match |
| MT3 | muitas memories do mesmo domínio | refinar e respeitar limite de 1–3 topics |
| MT4 | active index excede budget | `MEMORY_OVER_BUDGET`; sanitation antes de aumentar |
| MT5 | topic é narrativa excessiva | reduzir/retirar; topic acima do hard limit não passa review |

## Native memory ownership

| # | Capability/state | Expected behavior |
| --- | --- | --- |
| NM1 | native memory indisponível | repo memory continua sem fallback daemon/runtime |
| NM2 | native memory passa a existir | não duplicar nem depender exclusivamente dela para verdade técnica |
| NM3 | preferência geral do usuário | considerar owner native/user-global somente se suportado |
| NM4 | invariante crítico Wayper | canonical repo docs, nunca native-only |

## Memory long-run simulation

| # | Meta / learning delta | Expected promotion and next slice |
| --- | --- | --- |
| ML1 | slice A produz um fato derivável, uma decisão canônica, um pitfall hard-earned confirmado e estado temporário; slice B tem domínio do pitfall | derivável/temporário são descartados; decisão vai ao doc owner; só pitfall vira candidate e, se promoted, apenas esse topic pode ser carregado por B |

## Hook event selection

| # | Scenario | Expected | Forbidden |
| --- | --- | --- | --- |
| H1 | typo em doc comum | `DOCS_ONLY`; diff check | product FAST, full Jest ou Expo por reflexo |
| H2 | source de produção alterado | completion FAST backstop | concluir sem gate determinístico |
| H3 | tarefa executa 100 tool calls | zero execuções project-scoped de quality por tool call | `quality:gate` 100 vezes |
| H4 | slice Q3 de runtime | hook cobre no máximo FAST | usar hook como DEEP/review/physical proof |
| H5 | Stop com worktree limpa | `SKIP`, stdout vazio e custo near-zero | iniciar npm/Jest/Expo |
| H6 | tool event não cobre todo write/surface | reliability `LIMITED`; não usar como security boundary | garantia de write enforcement |

## Hook failure semantics

| # | Scenario | Expected |
| --- | --- | --- |
| HF1 | `quality:size` reporta regression | completion `FAIL`; indicar details |
| HF2 | architecture reporta regression | completion `FAIL`; indicar details |
| HF3 | lint JSON contém novo BUG_SIGNAL | completion `FAIL` |
| HF4 | backstop/process/parser falha | `TOOLING_ERROR`, distinto de código inválido |
| HF5 | FAST passa, mas device proof está pendente | hook não promove a conclusão; Q3 segue `PHYSICAL_VALIDATION_PENDING`/`INCONCLUSIVE` |
| HF6 | warnings legacy permanecem idênticos | `PASS`; não atribuir dívida preexistente ao diff |

## Hook economy

| # | Scenario | Expected |
| --- | --- | --- |
| HE1 | hook passa | 0 bytes em hook stdout |
| HE2 | hook falha | JSON/feedback curto com blocker e um comando de detalhe |
| HE3 | diff docs-only | somente diff check; nenhum product gate pesado |
| HE4 | três edições sequenciais em source | nenhum gate por edit; um backstop no attempted Stop |
| HE5 | agente já validou o mesmo diff | duplicação única no Stop é aceita conscientemente; nenhum cache complexo/versionado |

## Hook safety

| # | Scenario | Expected |
| --- | --- | --- |
| HS1 | baseline é alterada para esconder regression | hook nunca atualiza/aceita baseline automaticamente; alteração permanece revisável |
| HS2 | proposta de `eslint --fix` no hook | rejeitar; hook valida, agente corrige |
| HS3 | proposta de auto-commit | rejeitar; Git history pertence ao orquestrador |
| HS4 | proposta de auto-push | rejeitar; ação externa nunca é autorizada pelo hook |
| HS5 | evento/surface não observado | `UNKNOWN`/`DO_NOT_USE`; não bloquear com capability presumida |

## Hook and Goal integration

| # | Scenario | Expected |
| --- | --- | --- |
| HG1 | Meta com quatro slices | cada slice usa Q/R normal; hook apenas backstop no Stop |
| HG2 | specialist confirma blocker HIGH | review bloqueia/replaneja; hook não seleciona próximo candidate |
| HG3 | Goal depende de decisão humana de produto | Human Decision Boundary; hook não pergunta nem decide |

## Token economy modes

| # | Scenario | Expected | Forbidden |
| --- | --- | --- | --- |
| TE1 | localizar copy em arquivo grande | `COMPACT` no search; `EXACT` no range decisivo | abrir arquivo inteiro por reflexo |
| TE2 | JSON/NDJSON alimenta parser/auditoria | `EXACT`; query estrutural explícita pode selecionar fields | filtro que trunca/reformata silenciosamente |
| TE3 | warning de segurança ou ação irreversível | `CLEAR`, ordem e consequência explícitas | fragmentos ambíguos para poupar output |
| TE4 | suíte/gate passa | `COMPACT`: exit, contagens e warning material | lista completa de casos PASS |
| TE5 | suíte/gate falha | menor erro causal e expansão `EXACT` sob demanda | resumo que esconde stack, arquivo/linha ou partial failure |
| TE6 | usuário pede raw/exato | `EXACT` | RTK/Caveman substituir a evidência pedida |
| TE7 | doc, código, comentário, commit ou mensagem externa | prosa normal/persistida | gravar caveman como política ou source |
| TE8 | tarefa difícil consome contexto | preservar reasoning e reduzir desperdício periférico | baixar reasoning effort para melhorar métrica |

## Progressive context

| # | Scenario | Expected |
| --- | --- | --- |
| PC1 | typo/copy em `MapScreen` | `rg` + range suficiente + validação local; sem full file |
| PC2 | mudança bounded em formatter | owner symbol + caller/testes diretamente causais |
| PC3 | bug sem causa confirmada | expandir de symbol para todos os callers/failure paths relevantes |
| PC4 | arquivo pequeno e semanticamente coeso | leitura inteira permitida quando menor/mais segura |
| PC5 | range corta branch, cleanup ou `catch` | expandir range antes da claim/edição |
| PC6 | Graphify/search aponta relação material | confirmar no source/teste atual |
| PC7 | trivial/bounded sem memory match | `0` memory bytes |
| PC8 | Meta longa em um domínio/slice | owners/headings/ranges mínimos; não carregar `docs/ai` inteiro |

## Graph tooling

| # | Scenario | Expected | Forbidden |
| --- | --- | --- | --- |
| GR1 | target conhecido e consumer direto | `rg` + source; `NO_GRAPH` | refresh/query por reflexo |
| GR2 | ranking → XP com endpoints conhecidos | `path` opcional após refresh app-only; confirmar os três imports no source | tratar path como behavior proof |
| GR3 | save local → deferred queue → Firestore | persistence skill + source/testes; grafo só sugere working set | inferir chamada dinâmica ausente |
| GR4 | recovery/lifecycle/notificação/background task | active-run skill + source/testes/native boundary | provar wiring por proximidade ou nome |
| GR5 | impacto de `MapScreen` | `explain`/`affected` opcionais se evitarem leitura ampla; source confirma | abrir graph inteiro ou refatorar por degree |
| GR6 | boundary UI/Firestore/storage | checker arquitetural/allowlist/ratchet é owner | substituir enforcement por graph query |
| GR7 | localizar copy trivial | busca direta; zero build/query Graphify | custo fixo de índice |
| GR8 | selecionar hotspot seguro | size/complexity + owners/tests; graph só apoia inventário de imports/consumers | implementar o próximo debt slice nesta avaliação |
| GR9 | working tree `MODIFIED`/`STAGED`/`UNTRACKED` | refresh explícito lê o filesystem; sem refresh, cache é stale | atribuir semântica de versionamento ao stage |
| GR10 | troca de branch | zero hook; rebuild somente se a nova task selecionar Graphify | background rebuild automático |
| GR11 | graph result/memory | derivável, não autoritativo e não promovido | `save-result` default ou regra permanente |
| GR12 | código privado | `--code-only` local; backend remoto exige autorização e data review explícitos | envio implícito a LLM externo |

## Subagent brief e compaction

| # | Scenario | Expected |
| --- | --- | --- |
| SC1 | task permanece `S0` | `SUBAGENT_BRIEF_BYTES=0` |
| SC2 | delegação autorizada e elegível | menor `fork_turns`; outcome/scope/paths/evidence/validation |
| SC3 | wave seguinte precisa de descoberta anterior | somente Learning Delta relevante, sem histórico completo |
| SC4 | constraint/risk/dependency é material | preservar no brief mesmo que aumente bytes |
| SC5 | runtime compacta thread após milestone | revalidar Git/source/testes e continuar pelo estado compacto |
| SC6 | compaction produz continuidade de conversa | não tratar como memory, doc, source ou promotion |
| SC7 | CLI expõe compaction sem threshold/controle público confirmado | aceitar runtime; nenhum hook/fallback project-scoped |
| SC8 | histórico completo é indispensável à intenção | herança maior permitida e justificada; não cortar correctness |

## Accounting e benchmarks

| # | Scenario | Expected |
| --- | --- | --- |
| AB1 | bytes raw/optimized diminuem | reportar byte saving; não chamar de billed-token saving |
| AB2 | benchmark raw/optimized | mesmo cenário e exit code; divergência material invalida comparação |
| AB3 | filtro pode esconder evidence | retry `EXACT`; ausência de texto não prova ausência de problema |
| AB4 | nova política on-demand sem metadata | `PERMANENT_CONTEXT_BYTES` 0% growth |
| AB5 | contexto, tool output e model output mudam | métricas separadas; não somar unidades/estimativas incompatíveis |
| AB6 | provider receipt da sessão não existe | `TOTAL SESSION UNKNOWN/ESTIMATED` |
| AB7 | RTK/Caveman publicam percentuais próprios | registrar origem/overhead; não promover a receipt desta sessão |
| AB8 | T1–T4 | medir BEFORE/AFTER quando possível e manter quality/evidence gates verdes |

## Capability routing e Context Closure

| # | Entrada / relação confirmada | Closure esperada | Não pode ocorrer |
| --- | --- | --- | --- |
| CR1 | ranking semanal → XP | `weekly-ranking + xp-progression`; 0 skills | carregar social/território |
| CR2 | ranking → friends `INTERFACE_ONLY` | capability friends sem body adicional | promover interface a owner crítico |
| CR3 | ranking → membership de grupo | ranking + referência social | assumir implementação de ranking de grupo |
| CR4 | XP offline → deferred/sync/ranking | persistence skill + owners confirmados | fazer Firestore bloquear save local |
| CR5 | recovery → lifecycle/notificação | active-run skill | abrir território/ranking |
| CR6 | copy trivial | somente UI reference | expansão por palavra solta |
| CR7 | ranking local → profile stats | dependência inesperada entra após source walk | limitar-se ao mapa sugerido |
| CR8 | relação apenas `SUGGESTS` | somente entry capability | auto-load sem confirmação |
| CR9 | sugestão transitiva | closure não recursiva | carregar grafo inteiro |
| CR10 | catálogo simulado com 70 capabilities | duas capabilities, 0 skill bodies | persistir capability/skill falsa |
| CR11 | recovery → durable save `OWNER_CRITICAL` | active-run + persistence skills | omitir owner de persistência |
| CR12 | requisito sem owner/capability | `CAPABILITY_GAP` explícito | inventar skill ou capability |

O JSON é a fonte machine-readable desses 12 casos. O validator confirma schema,
paths, metadata das skills, evidência literal no source, closure, exclusões,
deduplicação, precision/recall e métricas de contexto. Ele não é classificador de
linguagem natural nem runtime paralelo.

## External skill acquisition

| # | Scenario | Expected |
| --- | --- | --- |
| ESA-A | capability interna suficiente | external discovery não ocorre |
| ESA-B | gap completo após internal search | external discovery permitida |
| ESA-C | popularidade + trigger overlap | somente temporary use; sem promoção cega |
| ESA-D | pure instruction compatível | `BASELINE` vetting + temporary trial |
| ESA-E | executable code | `STRONG` vetting antes de trial |
| ESA-F | instala hook sem isolamento | `REJECT` + `STRONG` vetting |
| ESA-G | muta config sem isolamento | `REJECT` + `STRONG` vetting |
| ESA-H | contradiz arquitetura Wayper | `REJECT` |
| ESA-I | útil com pequena adaptação | `ADAPT_TO_WAYPER` |
| ESA-J | nenhum candidato adequado | `BUILD_OUR_OWN` |
| ESA-K | mudança upstream material | re-vetting obrigatório; sem decisão automática |
| ESA-L | Find Skills broad trigger | `USE_TEMPORARILY`; Router Wayper permanece owner |
| ESA-M | catálogo interno simulado com 70 entries, sem gap | external discovery não ocorre |

[`external-skill-acquisition-evals.json`](external-skill-acquisition-evals.json)
é a fonte machine-readable. O validator confirma precondition, classes de risco,
decisões, provenance/registry links e métricas de bytes. Não pesquisa rede,
instala skill nem classifica linguagem natural.

## Validation protocol

1. conferir cada linha contra classes, flags, domínios, skills e specialists
   canônicos;
2. conferir processos contra `docs/ai/process-workflows.md` e validar que todos
   os identificadores existem uma única vez no owner;
3. conferir modes, status, DAG/wave e safety matrix contra
   `docs/ai/orchestration.md`;
4. conferir budgets/ratchet contra `docs/ai/code-budgets.md` e os casos B/BN;
5. conferir gate/review/status contra `docs/ai/quality-gates.md` e os casos
   G/RV/C/QN;
6. conferir Goal/autonomy/questions/follow-ups/learnings/stops contra
   `docs/ai/meta-goal-runtime.md` e os casos MG/A/QH/F/L/ST/LR;
7. executar `npm run quality:meta-goal` e conferir EGC01–EGC20 e SH01–SH12
   contra Goal Execution Contract, Validation Matrix e shadow esperado;
8. conferir promotion/routing/staleness/token/native memory contra
   `docs/ai/memory-policy.md` e os casos M/MR/MP/MS/MT/NM/ML;
9. conferir event selection/failure/economy/safety/Goal contra
   `docs/ai/hooks-and-gates.md` e os casos H/HF/HE/HS/HG;
10. conferir modes/context/brief/compaction/accounting contra
   [`token-economy.md`](token-economy.md) e os casos TE/PC/SC/AB;
11. executar `npm run quality:capabilities`, conferir CR1–CR12 contra source,
    registry e [`capability-architecture.md`](capability-architecture.md), e
    ESA-A–M contra
    [`external-skill-acquisition.md`](external-skill-acquisition.md);
12. validar links/paths do Harness;
13. registrar quantidade, pass/fail e divergência na entrega, sem alterar os
   resultados esperados para esconder falha.

O router primário continua uma política interpretada, não heurística de palavras.
Somente CR1–CR12 têm composição determinística executável; eles testam o contrato
de closure a partir de capabilities já classificadas, não intenção autônoma.

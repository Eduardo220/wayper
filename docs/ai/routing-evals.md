# Routing Evals — Wayper AI Harness V1

> **Status:** vigente<br>
> **Tipo:** suíte declarativa, sem API externa<br>
> **Owners:** [`task-classification.md`](task-classification.md) e
> [`context-routing.md`](context-routing.md), com safety de waves em
> [`orchestration.md`](orchestration.md)

Cada caso passa quando a classificação respeita todos os campos e não ativa os
recursos proibidos. `POTENTIAL` significa selecionar o recurso somente depois
que a inspeção confirmar a flag; não é ativação default.

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

## Validation protocol

1. conferir cada linha contra classes, flags, domínios, skills e specialists
   canônicos;
2. conferir processos contra `docs/ai/process-workflows.md` e validar que todos
   os identificadores existem uma única vez no owner;
3. conferir modes, status, DAG/wave e safety matrix contra
   `docs/ai/orchestration.md`;
4. conferir budgets/ratchet contra `docs/ai/code-budgets.md` e os casos B/BN;
5. validar links/paths do Harness;
6. registrar quantidade, pass/fail e divergência na entrega, sem alterar os
   resultados esperados para esconder falha.

Como o router é uma política interpretada e não um programa, estes evals não
simulam heurísticas de palavras. Eles testam o contrato semântico e, em
especial, os falsos positivos proibidos.

# Routing Evals — Wayper AI Harness V1

> **Status:** vigente<br>
> **Tipo:** suíte declarativa, sem API externa<br>
> **Owners:** [`task-classification.md`](task-classification.md) e
> [`context-routing.md`](context-routing.md)

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

## Validation protocol

1. conferir cada linha contra classes, flags, domínios, skills e specialists
   canônicos;
2. conferir processos contra `docs/ai/process-workflows.md` e validar que todos
   os identificadores existem uma única vez no owner;
3. validar links/paths do Harness;
4. registrar quantidade, pass/fail e divergência na entrega, sem alterar os
   resultados esperados para esconder falha.

Como o router é uma política interpretada e não um programa, estes evals não
simulam heurísticas de palavras. Eles testam o contrato semântico e, em
especial, os falsos positivos proibidos.

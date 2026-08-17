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

## Validation protocol

1. conferir cada linha contra classes, flags, domínios, skills e specialists
   canônicos;
2. validar que todos os identificadores existem uma única vez no owner;
3. validar links/paths do Harness;
4. registrar quantidade, pass/fail e divergência na entrega, sem alterar os
   resultados esperados para esconder falha.

Como o router é uma política interpretada e não um programa, estes evals não
simulam heurísticas de palavras. Eles testam o contrato semântico e, em
especial, os falsos positivos proibidos.

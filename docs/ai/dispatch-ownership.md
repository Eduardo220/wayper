# Dispatch + Ownership V1

Status: contrato project-owned da Fase 7. Owner: `scripts/wayper-dispatch.mjs`.
Estado de execução local: `.wayper-context/ownership/state.json`, ignorado pelo Git.
Não é Goal runtime, router, Evidence Receipt ou mecanismo de DONE.

## Fronteiras e fluxo

```text
Task estruturada -> SELECTIVE / decisão nativa existente -> planDispatch
  -> ExecutionGrant -> OwnershipLease (mutation)
  -> Context Resolver / Context Packet -> envelope task/actor/grant
  -> ActionPermit -> pre-guard -> ACTING persistido -> executor
  -> post-guard -> Evidence Receipts + resultado operacional
  -> Structured Handoff / owner merge -> Feedback / Validation / Completion
```

Antes, Packet/Handoff validavam contexto e assertions; Feedback tinha seu próprio
writer e o observer executava comandos sem contrato de mutabilidade. A exclusividade
de source, o spawn e a conclusão dependiam da disciplina do main/host. Agora os
adapters abaixo verificam autoridade persistida antes de seus efeitos.

Routing continua escolhendo adequação. Dispatch concede uma execução delimitada.
Ownership reserva material mutável. Evidence prova observações; Validation define
e avalia os checks. Somente Completion avalia admissibilidade.

## Task, plano e ator

`planDispatch({root, identity, task, actor?, availableActors?, routerAssessment?})`
consome o Working Context persistido atual. `root` é o checkout canônico do
control plane: todos os atores de um projeto devem usar o mesmo root, inclusive
tasks de site. Não há coordenação entre stores independentes ou máquinas.

Task tem schema fechado: `taskId`, `goalReference`, `repository`, `operation`
(`READ|MUTATE`), `scopes`, `capabilities`, `risks`, `taskClass`. A identidade
operacional é o `taskReference` completo com fingerprint; texto ou `taskId`
isolado nunca substitui Goal/revision/repository/operação/scope.

DispatchPlan schema 1 é fechado e contém `planId`, Goal e baseline, taskReference,
candidates, selectedActor, authorization, ownershipRequirement, stateFingerprint,
routerReference, contextPacketReference, reasonCodes e fingerprint. O `planId`
deriva dos fatos canônicos. Mesmos fatos produzem o mesmo plano.

O dispatcher filtra atores disponíveis de maneira determinística; não interpreta
prosa nem cria outro router. Specialist exige receipt `ROUTER_SELECTED` válido,
registrado no Context Map e coverage de capabilities. Mutation nunca seleciona
profile read-only. Mutation nativa prefere MAIN_OWNER, depois NATIVE_WRITER.
Seleção explícita incompatível é rejeitada, sem fallback silencioso para writer.

| Ator | Leitura/contexto/check | Mutation | Spawn | Request completion |
| --- | --- | --- | --- | --- |
| MAIN_OWNER | Sim | Somente task MUTATE + lease + permit | Grant de parent main válido | Sim, via Completion |
| NATIVE_WRITER | Sim | Somente task MUTATE + lease + permit | Não | Não |
| READ_ONLY_SPECIALIST | Sim, profile existente | Nunca | Nunca | Nunca |
| REVIEWER / VALIDATOR | Sim, profile read-only existente | Nunca | Nunca | Nunca |

Permissões: READ_CONTEXT, READ_SOURCE, QUERY_GRAPH, RUN_READ_ONLY_CHECK,
MUTATE_FILES, RUN_MUTATING_COMMAND, SPAWN_SPECIALIST, SUBMIT_HANDOFF e
REQUEST_COMPLETION. Não foram criados profiles. Model/effort continuam na policy
de `wayper-structured-handoff.mjs`; não concedem autoridade de escrita.

`issueGrant` revalida plano/Goal/baseline/state, persiste grant com ID novo, TTL
(default 60 s; máximo 300 s) e status ACTIVE. Grants vinculam ator, task, plano,
permissões, state, Packet, lease e fencingToken. `revokeGrant` exige CAS e recusa
execução incerta. State mismatch torna o grant STALE; revisão antiga não executa.
Grant mutável não é emitido depois que completion entrou em request/unknown/done.

## Scopes e snapshots

Scopes fechados: `{kind:'REPOSITORY',path:'.'}`, PATH_PREFIX e FILE, sempre
relativos ao repository explícito. Prefixo contém o próprio path e descendentes;
FILE contém apenas o arquivo; REPOSITORY sobrepõe qualquer scope do mesmo repo.
Paths absolutos, `..`, componentes vazios, backslash, symlinks e áreas `.git`/
`.wayper-context` são rejeitados. Site dirty é conservadoramente recusado para
mutation nesta versão, mesmo com outro Goal local.

State binding combina o snapshot Git existente (HEAD/index/diff/untracked) e os
hashes dos scopes FILE/PATH_PREFIX declarados, incluindo arquivos ignorados
nesses scopes. Prefixos têm limite de 4096 entradas; falta de captura é bloqueio.
Outputs materiais ignorados devem ser declarados explicitamente como FILE ou
PATH_PREFIX. REPOSITORY não transforma todos os caches/dependências ignorados
em um snapshot completo do filesystem.

Readers reservados impedem writer sobreposto. Reader novo é deferred diante de
lease aberta/expirada. Dois readers podem coexistir. Scopes de writers disjuntos
podem ser reservados, mas esta fase não ativa dispatch paralelo de mutations;
o snapshot Git conservador invalida assumptions após mudanças de outro writer.

## Lease, CAS e fencing

`acquireLease`, `renewLease`, `releaseLease`, `expireLease`, `reclaimLease` e
`reconcileGrant` usam o mesmo store. Lease schema 1 contém IDs de Goal/task/actor/
grant, repository/scopes, generation/fencingToken, acquiredAt/renewedAt/expiresAt,
state e fingerprint. Renew/release/expire exigem o actor corrente, generation,
fingerprint e fencing esperados; reclaim exige esses valores da lease e um grant
MAIN_OWNER atual separado.

Cada transição faz CAS do fingerprint do journal sob `flock` exclusivo curto,
reavaliando conflitos após CAS concorrente. O writer existente grava temp,
fsync, rename atômico e fsync do diretório. Lock do kernel termina quando o
processo morre; ele não é a lease. Plataforma suportada: filesystem local com
`flock` (verificado em Linux). Ausência da primitiva bloqueia, sem fallback racy.

Lease tem TTL e renew explícito, sem daemon. Reclaim fecha a lease expirada;
a próxima aquisição recebe generation global superior. O grant/permit antigo
é rejeitado por STALE_FENCE. Expiração de ACTING/UNKNOWN_OUTCOME/PARTIAL exige
reconciliation, nunca replay automático. Mesmo com expiry, readers e completion
não tratam resultado incerto como concluído.

Reclaim/reconciliation por outro ator exige um ExecutionGrant ACTIVE de MAIN_OWNER,
além dos fingerprints esperados, snapshot atual observado, motivo e confirmação
explícita de executor parado. Essa confirmação é fato fornecido pelo
owner/host; não é prova criptográfica nem detecção universal de processos remotos.
`reconcileStaleOwnership` fecha ownership de revisão antiga somente pelo main
da revisão atual, com os mesmos fatos e CAS, preservando os registros antigos.

## Permits e execução

ActionPermit schema 1 vincula grant, actor, lease/fence, hash da action, contrato
de mutabilidade e state esperado. A action inteira, inclusive conteúdo de write
ou command/args, participa do hash; conteúdo/argumentos não ficam no journal.

`issuePermit` exige Packet bound, grant atual e autorização. `beginAction` checa
novamente tudo e persiste permit CONSUMED + grant ACTING **antes** do efeito.
`executeFileAction` faz escrita atômica de um arquivo ou observação de source;
`executeAction` executa o comando observado. O runner mutável reivindica o permit
uma única vez por CAS; importar o producer com MUTATING sem essa autoridade falha.

O post-guard compara paths Git/material declarado antes/depois e conteúdo esperado
de writes. SCOPE_VIOLATION preserva arquivos, marca PARTIAL e bloqueia continuação.
State externo é EXTERNAL_CHANGE_DETECTED. Command mutável genérico retorna
UNKNOWN_ORIGIN/RECONCILIATION_REQUIRED: exit zero e diff dentro do scope não provam
ausência de efeitos remotos, descendants ou mudanças ignoradas não declaradas.
O projeto não tenta classificar todo shell por regex.

Contratos explícitos: WRITE_FILE é MUTATING; READ_FILE é READ_ONLY; COMMAND exige
READ_ONLY ou MUTATING. Desconhecido não executa. Specialist read-only só recebe
o executor fixo `git diff --check HEAD --` ou leitura de source; shell arbitrário
não vira read-only por uma declaração do specialist. Para comandos arbitrários
do main, a classificação explícita é responsabilidade do adapter/owner confiável.
Violação observada de READ_ONLY bloqueia a operação e conserva o receipt de exit
code, que permanece sujeito à verificação de stale pela Evidence V1.

## Context, spawn e handoff

`prepareDispatchPacket` usa `resolveContext` para arquivos existentes e o builder
de Packet existente. `bindResolvedDispatchPacket` consome o Context Map já
resolvido pelo owner (incluindo o caminho de Feedback). O envelope fechado tem
taskId, dispatchPlanId, grantId, actorId, Goal, scopes, Packet e `authority:NONE`.
Ele é persistido no grant; Packet de outro ator/dispatch não é autorização.
Expansões de contexto continuam pelo resolver do owner e novo scope exige
reassessment; o dispatcher não duplica Graphify nem materializa todo o projeto.

`dispatchSpawn` exige grant do parent MAIN_OWNER com SPAWN_SPECIALIST, grant do
specialist, Packet válido, depth 0, zero descendants e reserva de slot. Child é
depth 1 e não pode spawnar. Limite de slots vem de `slotLimit` e snapshot
`hostActiveSlots` informados pelo adapter do host, sem default histórico; ausência
retorna SPAWN_UNAVAILABLE. Nesta missão a interface expôs quatro slots totais.
Reservations project-owned são atômicas; occupancy fora do adapter não é observada
universalmente. Callback de spawn pode falhar após efeito: UNKNOWN_OUTCOME retém
a reserva até reconciliation. Model/effort previstos são os da policy existente;
modelo realmente usado pelo host é UNKNOWN quando ele não fornece observação.

`consumeDispatchHandoff` exige envelope e handoff fechados, task/grant/actor/Packet
exatos, descendants 0 e authority NONE. Reader passa pelo Structured Handoff V1
e `planContextMapMerge`: merge continua owner-reviewed. Writer deve listar paths,
permits observados, state resultante, checks e issues; `done` sozinho é inválido.
Adapters antigos de Packet/Handoff permanecem validadores de contexto/assertions;
não concedem spawn, lease, mutation ou completion.

## Evidence, Feedback e Completion

Evidence Receipt V1 não recebeu campos arbitrários. O resultado persistido do
permit referencia os receipts produzidos pelo observer; a cadeia grant/task/actor/
lease/fence fica no journal de dispatch. Em Feedback os mesmos receipts preservam
metadata taskId/attemptId/failureId já suportada por V1. Log de autorização não
prova correctness; Packet, handoff e exit zero não promovem assertions a Evidence.

Feedback.edit usa plan/grant/lease/Packet/permit e o mesmo file executor. Comandos
observados de Feedback usam a mesma boundary e contrato explícito. REVALIDATE
read-only não adquire lease de source. O check fixo de diff é conhecido; outros
checks automáticos requerem `checkMutability[check.id]`. Metadata do Context Map é
refrescada pelo owner explicitamente, sem reescrever proof assertions durante
emissão de Packet. Recovery recusa ownership pendente; scope violation/outcome
incerto exige owner reassessment. Feedback não recebe autorização para retry cego.

Completion consulta `ownershipProblems` na API canônica, também consumida pelo
Stop existente. `requestGoalCompletion` aceita somente MAIN_OWNER com grant
project-owned atual que contenha `REQUEST_COMPLETION`, Goal atual, assessment
ADMISSIBLE e ownership fechado. Grants mutáveis ACTIVE/HANDED_OFF também bloqueiam.
Uma reserva CAS impede novo grant/acquisition mutável entre assessment e callback
do host. Falha incerta do callback exige
`reconcileCompletionRequest`; o registro é da **requisição**, nunca um DONE paralelo.
Sem callback oficial retornado pelo host, o resultado é HOST_UNAVAILABLE.

## Telemetria e limites de enforcement

`dispatchTelemetry` expõe planos/grants/denials, leitores/writers, leases,
conflicts/expiry/reclaim/fences, scope violations, external changes, spawns e
completion requests. Events conservam os últimos 128 registros; contadores
acumulam apenas chamadas observadas. Journal tem budget de 1 MiB e falha fechado
quando excedido; não apaga ownership incerto para liberar espaço.

| Superfície | Cobertura |
| --- | --- |
| APIs project-owned acima | Enforcement mecânico, exercitado por testes/fixtures |
| Declaração semântica de mutabilidade pelo owner de shell arbitrário | Contrato confiável + detecção posterior; não sandbox universal |
| Native shell / arbitrary filesystem write | PARTIAL: bypass do host; mismatch pode detectar, não prevenir universalmente |
| Native spawn fora do adapter | PARTIAL; não existe interceptação global provada nesta integração |
| Native update_goal | PARTIAL; request project-owned governada, ferramenta nativa independente |
| Stop | Reusa Completion; hook configurado não prova interceptação universal |
| Cross-repo | Fase 8 compõe tasks/assessment; grants, leases e receipts continuam isolados; sem transação atômica |

Esta boundary não cria daemon, scheduler, fila, banco, router adicional, profile
novo, alteração de host externo, Memory/Brain/promotion ou transação distribuída.
A composição posterior pertence a
[`cross-repo-coordination.md`](cross-repo-coordination.md); Durable Memory pertence
a [`memory-policy.md`](memory-policy.md). Ambas preservam snapshots, leases,
receipts e autoridade separados por repo.

## Validação e rollback

`quality:dispatch` cobre decisão, autorização, execução, spawn, handoff e circuitos.
`quality:ownership` cobre lifecycle, CAS multiprocesso, zombie e crash/reclaim.
Ambas integram `quality:gate`, seleção do backstop e registry de validação.
Regressões dos owners Evidence/Feedback/Completion/Context/Packet/Handoff continuam
obrigatórias. Fixture não prova aparelho físico, produto real ou spawn nativo.

Rollback de source é o revert do commit da fase. Antes de retirar os adapters,
fechar/reconciliar operações pendentes e preservar o journal ignorado para auditoria;
nunca limpar source, leases incertas ou WIP externo automaticamente.

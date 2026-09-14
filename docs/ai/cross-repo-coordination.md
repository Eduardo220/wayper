# Cross-Repo Coordination V1

> **Status:** implementado na Fase 8A do Harness V2
> **Owner:** `scripts/wayper-cross-repo.mjs`
> **Quality:** `npm run quality:cross-repo`

## Fronteira

Um Project Goal e suas repository tasks têm identidades distintas. O plano
canônico é Goal/revision/baseline-bound e nunca converte uma task mobile em prova
da task site.

```text
Project Goal
  -> CrossRepoPlan
     -> wayper task -> Dispatch/Ownership/Evidence/Validation/Feedback
     -> wayper-site task -> Dispatch/Ownership/Evidence/Validation/Feedback
  -> CrossRepoAssessment
  -> Completion Boundary
```

`CrossRepoPlan` schema 1 contém `planId`, `goalReference`, baseline por repo,
repositories participantes, tasks, edges e policy de completion. Cada task
contém `taskId`, `goalRunId`, `revision`, `repository`, `operation`, scopes,
capabilities, risks, dependencies, materialidade blocking e fingerprint do
scope. Somente repositories com task real entram no plano; um Goal single-repo
não cria task site.

Edges são mínimos e direcionais: `REQUIRES`, `BLOCKS`, `PRODUCES_FOR` ou
`VALIDATES_WITH`. O source task é pré-requisito do target. Relação desconhecida
não é inferida por texto. Mudança em source path declarado invalida somente o
dependent closure comprovado; `affectedTasksForAmendment` preserva planning
independente.

## Assessment e Completion

`CrossRepoAssessment` schema 1 contém estados por repository, task e dependency,
blockers/warnings, decisão, métricas e fingerprint. Decisões são `COMPLETE`,
`INCOMPLETE`, `BLOCKED`, `REPLAN_REQUIRED` e `INVALID_STATE`.

Task `COMPLETE` requer sua própria decisão `ADMISSIBLE`, Validation `COMPLETE` e
refs de Evidence do mesmo repository. O assessment apenas compõe resultados; ele
não substitui Evidence, Validation ou Completion. Um assessment publicado sob
`.wayper-context/cross-repo/<goalRunId>/r<revision>/` é consumido pela Completion
Boundary. Assessment não `COMPLETE` produz blocker global. Sem plano publicado,
nenhum trabalho cross-repo artificial é exigido.

Não existe transação distribuída. Se mobile completa e site falha, mobile
permanece completo, site bloqueia o Project Goal e Feedback recebe somente a
task falha quando os edges permitem. Correção que altera dependency material
exige revalidar apenas dependents declarados. Não há rollback automático.

## Autoridade e isolamento

- plano não concede grant, lease, fence, permit ou write;
- cada task entra nas APIs existentes de Dispatch/Ownership por repository;
- receipt ou validation de um repo não satisfaz o outro;
- handoff precisa preservar Goal, task, repository e dispatch;
- composição de contexto contém apenas refs agrupadas por repo com
  `authority: CONTEXT_ONLY`;
- Graphify continua com graphs mobile/site separados; graph stale usa source
  fallback e não é reconstruído sobre WIP externo inseguro.

## WIP externo

Baseline registra branch, HEAD, dirty paths e content fingerprint por repository.
Read-only de scope seguro é permitido. Uma task `MUTATE` que sobrepõe dirty path
fica `EXTERNAL_CHANGE_PRESENT`; scope comprovadamente disjunto pode planejar,
mas ainda precisa do grant/lease/permit repo-scoped da Fase 7. O Harness não
reset, stash, clean, checkout, incorpora ou assume ownership do WIP; sem prova
mecânica de independência, continua bloqueado.

## Observabilidade e enforcement

`crossRepoTelemetry()` expõe `crossRepoGoals`, `repoTasks`, `dependencyEdges`,
completed/blocked, revalidations, feedback cycles e external repo blocks. Não há
dashboard.

| Capacidade | Estado |
| --- | --- |
| Project Goal decomposition e task isolation | ENFORCED/PROVEN nas APIs project-owned |
| Dependency blocking e global completion | ENFORCED/PROVEN |
| Dispatch, Ownership, Evidence por repo | reutilizados; enforcement da Fase 7 |
| Site WIP protection | ENFORCED/PROVEN nas APIs; host direto permanece bypass parcial |
| Cross-repo rollback/atomicity | NOT_IMPLEMENTED deliberadamente |
| Coordenação entre máquinas | NOT_IMPLEMENTED |

Rollback da Fase 8 é revert do commit. Operações já concluídas por repo não são
desfeitas automaticamente.

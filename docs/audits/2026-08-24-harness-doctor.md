# Unidade 18 — Harness Doctor e benchmark operacional

> Data: 2026-08-24<br>
> Branch: `feat/wayper-ai-harness`<br>
> Baseline: `316499984aaee147ed9416a8e00a465701fb0f93`<br>
> Base comparada: `origin/develop` em `65a60a6d6d26b03500dc2053d4de1735ff01d791`<br>
> Escopo alterado: somente Harness, evals e esta auditoria; nenhum source funcional.

## Resumo executivo

`HARNESS_HEALTH=HEALTHY_WITH_DEBT`. O Harness integrado roteou B1–B10 com
Context Closure proporcional, zero skill project-scoped irrelevante e zero
dependência de grafo. Um wave read-only de três especialistas encontrou valor
real: um bug de ranking `HIGH`, uma lacuna lifecycle `MEDIUM` e uma corrida de
notificação `LOW`. Todos são produto e ficaram classificados, sem correção nesta
Unidade.

O principal defeito do próprio Harness era orçamentário: o soft limit de 85%
não reservava capacidade calculada para a finalização. A Unidade 17 iniciou a
fase final em 499.891 tokens de um teto textual de 500.000 e terminou em
514.548, além de 18.910 tokens efetivos observados após o terminal canônico.
Foi acrescentado `FINALIZATION_ONLY`, com reserva por Meta e source explícita;
não foi criado novo runtime, hook, router ou benchmark permanente.

## Estado integrado

| Componente | Estado observado | Resultado |
| --- | --- | --- |
| `AGENTS.md` + catálogo | 3.046 B; owners e leitura progressiva coerentes | saudável |
| Classifier/Router | declarativo; 12/12 capability evals, precision/recall 100% | saudável |
| Capability registry | 55 capabilities, 20 assets, 12.111 B on-demand | saudável |
| Skills | 4 project-scoped; 12.872 B de bodies; média B1–B10 0,2/task | saudável |
| References | 16, deduplicadas por asset | saudável |
| Context Closure | source-confirmed; suggested edges não carregam recursivamente | saudável |
| Orchestration | S0/S1/S2 úteis; S3 write split recusado | saudável |
| Specialists | 4 contratos read-only; três ativações nesta auditoria | saudável |
| Quality | Q0–Q3/R0–R3; FAST gate e checks direcionados | saudável |
| Goal runtime | completion evidence e budget Harness; native budget ausente | saudável com limite |
| Memory | index 42 B, zero entries; native memories desativadas | vazio por decisão |
| Hooks | um `Stop` project-scoped; sem julgamento semântico | saudável |
| Token Economy | 4.402 B permanentes; 0 B de crescimento nesta Unidade | saudável |
| Design | `DESIGN.md` 19.372 B on-demand; 12/12 evals | saudável |
| External skills | policy/evals/provenance; trial sem promoção | saudável |
| Graphify | opcional, sem graph atual, instalado atrás do upstream | reconfigurar/atualizar |
| RTK | manualmente obrigatório nesta sessão; ganho pequeno no corpus curto | dívida de integração |
| Caveman | ativo no output conversacional; prosa persistida normal | saudável |
| Codex | 0.149.0; goals/hooks/multi-agent/compaction estáveis | update menor disponível |

As regras currentes não formam ciclo de autoridade nem sombreiam ferramentas
globais. O projeto não possui `.codex/config.toml`; modelo, effort, permissões,
plugins, RTK, Caveman e Graphify continuam user-scoped. Skills usam progressive
disclosure conforme a [documentação oficial do Codex](https://developers.openai.com/codex/build-skills),
o `Stop` segue o contrato oficial de [hooks](https://developers.openai.com/codex/hooks)
e os especialistas estreitos seguem [subagents](https://developers.openai.com/codex/agent-configuration/subagents).

## Baseline histórica e reserva

Fonte: receipts `thread_goals` de `~/.codex/goals_1.sqlite`; budgets pedidos
vieram dos objetivos anexados, nunca foram confundidos com `token_budget` nativo.

| Execução | Request textual | Native | Uso | Duração | Resultado |
| --- | ---: | --- | ---: | ---: | --- |
| Unidade 13 | não declarado | `NULL` | 629.631 | 6.310 s | complete |
| Unidade 15 | não declarado | `NULL` | 474.490 | 2.798 s | complete |
| Unidade 16 | não declarado | `NULL` | 411.967 | 1.451 s | complete |
| Budget bridge | 70.000 | `NULL` | 119.945 | 479 s | blocked; API adaptation |
| Unidade 17 | 500.000 | `NULL` | 514.548 | 1.545 s | complete com overrun Harness |

Na Unidade 17, o último checkpoint antes de finalização registrou 499.891 e o
terminal nativo registrou 514.548: 14.657 para gates/review/commit/bookkeeping.
O rollout registrou 18.910 tokens efetivos adicionais entre completion e síntese;
cleanup isolado mediu 956. Estimativa por categoria: validações 4,2k, review +
commit 4,3k, cleanup 1,0k, bookkeeping 1,8k e síntese 19,0k. O envelope observado
foi 34.523; margem de 30,4% produz reserva arredondada de 45.000.

Contrato desta Meta:

```text
REQUESTED_TOKEN_BUDGET=650000
HARNESS_TOKEN_CEILING=650000
SOFT_LIMIT=552500
FINALIZATION_RESERVE_TOKENS=45000
SUBSTANTIVE_TOKEN_CEILING=605000
NATIVE_GOAL_TOKEN_BUDGET=UNSET
TOKEN_ENFORCEMENT_MODE=HARNESS
```

## B1–B10

O comparativo é replay controlado permitido pelo objetivo: mesma intenção e
mesma conclusão, `OLD` carregando arquivos inteiros + quatro skills, `HARNESS`
carregando registry/asset/ranges selecionados. Bytes são UTF-8 observados; não
são billed tokens. `tool calls` é o plano de replay, não receipt da sessão.

| Caso | Classe / domínio | Closure e ativação | Q/R/S | Conclusão |
| --- | --- | --- | --- | --- |
| B1 | `TRIVIAL` / diagnostics UI | range de copy; 0 skill, 0 memory, sem graph | Q0/R0/S0 | contexto mínimo; sem design |
| B2 | `BOUNDED` / diagnostics | `local-diagnostics`, reference + owner/test ranges | Q1/R1/S0 | single-domain suficiente |
| B3 | `BUG_INVESTIGATION` / social + rules | `weekly-ranking -> xp-progression`, reference `ranking-xp` | Q1/R1/S0 | CR1 confirmado no source |
| B4 | `BUG` cross-domain persistence/social | persistence skill, deferred/sync/progression/ranking | Q2/R2/S1 em wave S2 | bug HIGH reproduzido |
| B5 | `CRITICAL` run runtime | active-run skill, runtime/recovery/notification | Q3/R3/S2 | MEDIUM + LOW classificados |
| B6 | design `OPERATE` / ranking | DR3: system/layout/gamification; ranges de `DESIGN.md` | Q1/R1/S0 | regras/dados preservados |
| B7 | design `EXPERIENCE` / post-run | DR4: system/layout/motion/gamification/post-run | Q1/R1/S0 | experiência sem runtime ativo |
| B8 | `CAPABILITY_GAP` / social | `group-tournament-bracket`; external vetting/trial | Q1/R2/S0 | candidato rejeitado; sem promoção |
| B9 | `ARCHITECTURAL` / MapScreen | graph ausente -> outline/ranges/caller no source | Q2/R2/S0 | fallback correto; sem arquivo inteiro |
| B10 | `SAFE_REFACTOR` / diagnostics | screen handlers/caller/service tests | Q2/R2/S0 | fatia segura caracterizada |

### Métricas do replay

| Caso | Prompt OLD/Harness B | Context/source OLD/Harness B | Calls OLD/Harness | Redução contexto |
| --- | ---: | ---: | ---: | ---: |
| B1 | 177 / 43 | 69.201 / 1.669 | 8 / 3 | 97,6% |
| B2 | 189 / 55 | 58.858 / 17.759 | 9 / 6 | 69,8% |
| B3 | 177 / 43 | 93.548 / 27.827 | 12 / 7 | 70,3% |
| B4 | 178 / 44 | 158.359 / 40.115 | 15 / 13 | 74,7% |
| B5 | 196 / 62 | 466.904 / 57.370 | 14 / 10 | 87,7% |
| B6 | 188 / 54 | 68.095 / 23.976 | 8 / 6 | 64,8% |
| B7 | 189 / 55 | 62.331 / 21.686 | 8 / 6 | 65,2% |
| B8 | 178 / 44 | 30.513 / 26.745 | 8 / 5 | 12,3% |
| B9 | 210 / 76 | 314.307 / 58.262 | 9 / 8 | 81,5% |
| B10 | 186 / 52 | 159.836 / 46.001 | 12 / 8 | 71,2% |
| **Total** | **1.868 / 528** | **1.481.952 / 321.410** | **103 / 72** | **78,3%** |

`IRRELEVANT_SKILL_LOADS=0`, `MISSED_CAPABILITIES=0`. O OLD overfetch relativo
à closure escolhida foi 1.160.542 B. O Harness ainda abre o registry completo
quando necessário; portanto zero skill irrelevante não significa zero byte
irrelevante. A computação do replay levou 0,2 s; investigação compartilhada por
caso não foi artificialmente atribuída.

## Orchestration e valor especialista

S0 resolveu B1–B3 e B6–B10. B4/B5 formaram uma wave S2 de três leituras
independentes; cada agente foi S1 individual e read-only. Briefs mediram 658 B,
570 B e 557 B (`SUBAGENT_BRIEF_BYTES=1.785`). Escrita paralela S3 foi recusada:
os três tocariam owners compartilhados e a auditoria exigia síntese única.

Achados:

1. `HIGH`, B4: `rankingRepository.listRanking()` devolve remoto cru quando não
   vazio; o overlay local só ocorre no fallback de cache. Teste RED temporário
   observou remoto `totalXp=0` contra local durable `26`; recebeu `0`, esperado
   `26` + `localOverlay`. O teste foi removido e nenhum produto mudou.
2. `MEDIUM`, B5: fallbacks `active_evidence`/catch de
   `reconcileActiveRunState()` preservam a corrida, mas não chamam
   `ensureNotificationForActiveRun()`. Exige teste e aparelho real.
3. `LOW`, B5: single-flight de `startRunNotification()` coalesce payload RUNNING
   e PAUSED, deixando UI nativa stale até ticker; ação continua consultando o
   snapshot canônico.

Os especialistas trouxeram ownership, ordenação local/remoto e reentrância
cross-state que busca textual não julgaria. Nenhum achado autoriza correção fora
do escopo desta Unidade.

## External skills, Graphify, memory e compaction

B8 provou `CAPABILITY_GAP` após busca interna. Skills CLI 1.5.23 encontrou
`onewave-ai/claude-skills@bracket-predictor` (257 installs; repositório com 270
stars). `skills use` fez trial efêmero em 2,34 s, sem instalação. O conteúdo era
predição esportiva genérica, não construção de bracket, e a varredura mostrou
vários YAML inválidos. Resultado: `REJECTED`, sem provenance/promoção permanente.

Graphify real: `graphifyy 0.9.38`, Apache-2.0, origem
`Graphify-Labs/graphify`; upstream PyPI era 0.9.49 no mesmo dia. Não existe
`graphify-out/graph.json`; B9 observou `GRAPH_UNAVAILABLE` e caiu para source.
Isso confirma a decisão `RECONFIGURE`, sem rebuild, hook ou arquivo gerado. A
[metadata PyPI](https://pypi.org/project/graphifyy/) é autoridade para a versão
publicada; graph e query continuam pistas, nunca source of truth.

Memory project-scoped possui zero entries; usefulness e staleness são `N/A`.
Os três findings pertencem a source/test/follow-up, não a memory. Memory nativa
do Codex está stable porém desativada. `remote_compaction_v2` e request
compression estão ativos; uma compaction desta sessão preservou objetivo,
critérios e ledgers, com `CONTEXT_LOSS_INCIDENTS=0` observado.

## RTK e Caveman

Pares raw/otimizado preservaram exit code e texto decisivo:

| Cenário | Exit | Raw/opt B | Resultado |
| --- | ---: | ---: | --- |
| test PASS | 0 | 2.243 / 2.243 | igual |
| test FAIL | 1 | 54 / 54 | path ausente preservado |
| lint PASS | 0 | 0 / 24 | overhead de resumo |
| lint FAIL | 1 | 171 / 202 | regra/arquivo preservados |
| git PASS | 0 | 8 / 8 | igual |
| git FAIL | 128 | 201 / 202 | ref inválida preservada |
| status PASS | 0 | 231 / 230 | -0,4% |
| status FAIL | 129 | 1.249 / 1.249 | usage preservado |
| search PASS | 0 | 738 / 738 | igual |
| search sem match | 1 | 0 / 0 | igual |
| Jest completo | 0 | 4.405 / 4.378 | -0,6%; 56/56, 623/623 |

Total deste corpus: 9.300 B raw contra 9.328 B otimizado (+0,3%). Logo RTK não
foi promovido como economia universal. `rtk gain` user-global estimou 21,4M de
30,9M tokens de input evitados (69,2%), mas isso é métrica própria, não receipt
do provider. Ele também avisou `No hook installed`; há adapter Codex global,
mas `unified_exec` atual exigiu prefixo manual. Estado: `USEFUL_WITH_DEBT`.

Caveman full esteve ativo em commentary/briefs. A/B do mesmo model turn não
existe; `CURRENT_GOAL_MODEL_OUTPUT_SAVINGS=UNKNOWN`. Fixture ASCII equivalente
mediu 205 B normal contra 114 B compacta (-44,4%). Documentação, código e commit
messages permanecem prosa normal, provando compatibilidade sem contaminar
artefatos persistidos.

## Falhas, hooks e Human Decision Boundary

Injeções seguras cobriram: registry com capability desconhecida; skill id
divergente; gap real; malformed/timeout/inconsistent gate output; Stop ativo sem
loop; limite hard imutável; reserva de finalização; Graphify ausente; external
skill inválida; test/lint/git/status/search com exit não-zero; teste RED B4.
Self-tests verificam feedback `Stop` menor que 250 B e distinguem `FAIL` de
`TOOLING_ERROR`. O único hook de projeto continua determinístico e silencioso no
sucesso.

Boundary humano:

- conflito entre owners aprovados sem precedência -> `GOAL_BLOCKED`, perguntar;
- promoção/instalação permanente externa -> decisão humana após vetting;
- findings de produto sob ordem explícita “não alterar source” -> classificar e
  colocar na fila, sem pergunta nem expansão;
- nenhum conflito real desta Unidade exigiu interromper a autonomia.

## Correção aplicada ao Harness

`evaluateBudgetControl()` agora aceita reserva evidenciada por Goal, calcula
`substantiveTokenCeiling` e entra em `FINALIZATION_ONLY`. Nesse estado somente
`workClass=FINALIZATION` é permitido; trabalho substantivo obrigatório também é
negado. Dois budget evals e um self-test provam stop e admissão da finalização.
O checkpoint `BEFORE_FINALIZATION` foi adicionado. Rollback: reverter o commit
desta correção; nenhum dado ou produto é afetado.

## Próxima tarefa real selecionada

`Fix local XP overlay on non-empty remote ranking` substitui a candidata B10
porque possui falha RED observada e valor maior.

```text
GOAL: preservar XP total local monotônico do usuário atual quando o ranking
      remoto estiver atrasado, sem alterar outros usuários.
SCOPE: src/repositories/rankingRepository.js
       src/repositories/__tests__/rankingRepository.test.js
       docs/wayper/06-xp-nivel-ranking.md somente se o contrato mudar
OUT: sync engine, progression math, UI redesign, refactor amplo
INVARIANTS: local-first; totalXp não regride; remoto maior vence; sem duplicata;
            outros rows/order preservados e reordenados pelo critério final
RISK: HIGH de correctness visível; baixo risco de escrita remota
Q/R: Q2 + R2; S0, S1 persistence só se freshness ficar ambígua
TEST: remoto 0/local 26 -> 26 overlay; remoto 40/local 26 -> 40;
      outro usuário preservado; fallback cache continua verde
VALIDATION: rankingRepository + progression + deferred + sync + ranking suites,
            lint do diff, quality:gate, full Jest se risco agregado subir
FILES_MAX: 3
HARNESS_TOKEN_CEILING: 35000
FINALIZATION_RESERVE: 8000
SUBSTANTIVE_TOKEN_CEILING: 27000
EARLY_COMPLETION: testes/semântica verdes e nenhum finding material
ROLLBACK: revert do commit único
```

## Readiness 1–28

Validação final: 86/86 self-tests de quality tooling; capability 12/12;
external 13/13; design 12/12; completion 20/20 + shadow 12/12 + budget
22/22; Jest 56/56 suites e 623/623 testes; `quality:gate=PASS` com 0 erro,
336 warnings baseline/336 atuais, 0 bug signal novo, 0 regressão de size ou
architecture; `quality:backstop=PASS`. O primeiro backstop detectou whitespace
no relatório untracked, corrigido antes do PASS. Validação Android física:
`NOT_RUN`, pois não houve mudança funcional.

| # | Estado | Evidência |
| ---: | --- | --- |
| 1 | PASS | B1–B10/closure e 78,3% de redução replay |
| 2 | PASS | especialistas só B4/B5; findings reais |
| 3 | PASS | B9 `GRAPH_UNAVAILABLE -> SOURCE` |
| 4 | PASS | memory vazia auditada; N/A honesto |
| 5 | PASS | OLD/Harness, mesma intenção/conclusão |
| 6 | PASS_WITH_DEBT | corpus RTK completo; +0,3% local, ganho global separado |
| 7 | PASS | fixture -44,4%; receipt atual UNKNOWN |
| 8 | PASS | compaction real, zero perda observada |
| 9 | PASS | prompt/context/source/calls por task |
| 10 | PASS | prompt curto sem regras duplicadas |
| 11 | PASS | contratos/evals/gates integrados |
| 12 | PASS | sem conflito de autoridade encontrado |
| 13 | PASS | project/global/generated separados |
| 14 | PASS_WITH_DEBT | Stop útil; RTK hook warning classificado |
| 15 | PASS_WITH_DEBT | versões reais; Graphify/Codex atrás |
| 16 | PASS | no project config; defaults/read-back registrados |
| 17 | PASS | cinco receipts históricos e overrun explicado |
| 18 | PASS | reserva 45k derivada e evals |
| 19 | PASS | soft stop observado; finalização priorizada |
| 20 | PASS | boundary testado e aplicado |
| 21 | PASS | zero source/UI funcional alterado |
| 22 | PASS | 56 suites/623 testes; physical NOT_RUN |
| 23 | PASS | self-tests e gates direcionados |
| 24 | PASS | cleanup temporário concluído; árvore limpa verificada no fechamento |
| 25 | PASS | Harness corrigido; produto HIGH/MEDIUM/LOW classificado |
| 26 | PASS | nenhum router/hook/runner/dependency novo |
| 27 | PASS | correção e relatório separados em commits coerentes |
| 28 | PASS | tarefa B4 com contrato, risco, gates e budget |

`HARNESS_DOCTOR_READY=YES`. Dívidas restantes: corrigir
B4 em unidade própria; caracterizar B5 e validar aparelho; atualizar Graphify e
Codex de forma user-scoped; alinhar auto-hook RTK com `unified_exec` se ROI real
em corpus grande justificar.

# Multi-Agent Orchestration — Wayper AI Harness V1

> **Status:** vigente<br>
> **Escopo:** delegação e waves no repositório mobile<br>
> **Owner:** [`docs/ai/harness-v1.md`](harness-v1.md)<br>
> **Router:** [`docs/ai/context-routing.md`](context-routing.md)<br>
> **Quality:** [`docs/ai/quality-gates.md`](quality-gates.md)<br>
> **Meta Goal:** [`docs/ai/meta-goal-runtime.md`](meta-goal-runtime.md)<br>
> **Evals:** [`docs/ai/routing-evals.md`](routing-evals.md)

O agente principal do Codex é o único orquestrador. Multi-agent é opt-in por
valor; não é um tier de qualidade nem um passo obrigatório. Este protocolo é
declarativo: não existe Brain, planner executável, custom orchestrator ou
generic implementer/reviewer.

Evidence Receipts V1 seguem [evidence-receipts.md](evidence-receipts.md).
Packets levam IDs bounded por repo/subject. Handoffs podem devolver
`existingEvidenceReceiptIds`; assertions novas, inclusive resultados de teste,
ficam `HANDOFF_ASSERTED/UNVERIFIED` no merge plan e exigem observação do owner.
Isso preserva owner review, correction bounded e fallback; não acrescenta
enforcement de dispatch, writers ou scheduling.

O [Validation Planner](validation-planner.md) acrescenta requirements bounded ao
Packet. Handoff pode propor `validationFindings`; required/blocking/N/A não são
editáveis pelo specialist. O owner deve reavaliar o plano, preservando os receipts.

## Suporte observado e boundary de configuração

Na baseline observada de 2026-09-02, Codex CLI `0.152.1` expõe multi-agent estável,
subagents nativos, steering/interrupção e custom agents project-scoped em
`.codex/agents/`. A sessão atual oferece quatro slots totais, incluindo o agente
principal; a configuração global e o projeto não definem `[agents]` nem limite
próprio. O limite efetivo continua pertencendo ao runtime.

- O dispatch canônico aplica `specialist-risk-capability-task-cost-v1`: modelo e
  reasoning são explícitos por chamada; os TOMLs continuam sem override estático
  para permitir variação por risco/tarefa. Invocações externas ao Harness ainda
  herdam a configuração aplicável.
- Não versione limite de concorrência enquanto o default suportado e o cap do
  runtime forem suficientes. Como orientação, não exceda três a quatro agentes
  totais sem benchmark e nunca exceda o cap anunciado pela sessão.
- O runtime atual permite delegação aninhada, mas o Harness fixa `max_depth=1`:
  specialists e workers Wayper não delegam. O agente principal permanece o
  único nível de orquestração.
- Subagents desta sessão compartilham checkout e filesystem. Isso não fornece
  isolamento para escrita; worktree é uma decisão separada.

Referência externa do mecanismo: documentação oficial de
[subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[configuração](https://learn.chatgpt.com/docs/config-file/config-reference) e
[worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees).

## Decision gate

Use multi-agent somente quando pelo menos um valor material existir:

- `CONTEXT_ISOLATION`: exploração separada evita poluir decisões do agente
  principal;
- `REAL_SPECIALIZATION`: um profile catalogado possui responsabilidade pertinente;
- `REAL_PARALLELISM`: unidades independentes podem avançar simultaneamente;
- `INDEPENDENT_REVIEW`: perspectivas read-only reduzem risco concreto.

Considere também overhead de agente, contexto duplicado e síntese contra
speedup, isolamento, especialização e redução de risco. Se o valor líquido for
baixo ou incerto, use `S0`.

O Decision Gate continua definindo `S0-S3`, intenção read-only/writer e valor de
delegação. Depois de `S1/S2` read-only, um receipt `ROUTER_SELECTED` pode escolher
o profile somente quando a coverage for completa e sem residual; qualquer outro
resultado é `BEHAVIORAL_FALLBACK`. O router nunca cria wave, chama specialist ou
autoriza spawn.

Não delegue typo, copy, styling local, rename local, doc pequena, arquivo único
bem compreendido, investigação curta, teste simples, `BOUNDED` sem
especialização, passos sequenciais ou tasks que disputam arquivo/recurso. Dois
arquivos pequenos não justificam uma wave apenas para ganhar segundos.

## Modos

| Mode | Execução | Gate |
| --- | --- | --- |
| `S0 — SINGLE` | agente principal investiga, altera e valida | default; nenhum valor multi-agent comprovado |
| `S1 — SPECIALIST_ASSIST` | principal executa; um specialist read-only analisa ou revisa | uma especialização real compensa o overhead |
| `S2 — PARALLEL_READ` | duas ou mais investigações/reviews read-only independentes na mesma wave | leituras são independentes e flags selecionam cada agente |
| `S3 — PARALLEL_WORK` | workers nativos escrevem unidades independentes | somente após `PARALLEL_WRITE_ELIGIBLE=YES` |

Prefira `S2` a `S3`. Specialists não conversam entre si, não votam e não
aprovam integração; o principal recebe e sintetiza cada resultado.

## Contrato de decomposição

Antes de formar waves, cada unidade não trivial registra:

```text
TASK_ID:
DESCRIPTION:
CLASS:
RISK_FLAGS:
DOMAINS:
PROCESS:
GATE_LEVEL:
REVIEW_MODE:
FILES_READ:
FILES_WRITE:
DEPENDS_ON:
SHARED_RESOURCES:
OWNER:
MODE:
VALIDATION:
```

`FILES_WRITE` pode começar como `UNKNOWN`, mas a task não entra em wave de
escrita assim. Primeiro investigue em `S0`/`S2`, estabilize owner e escopo e
recalcule o plano.

## DAG e dependências

`B` depende de `A` quando usa código/interface/decisão de `A`, altera o mesmo
arquivo/owner/estado persistente, compartilha contrato mutável ou só pode ser
validada depois de `A`. Dependência transitiva conta: em `A -> B -> C`, `A` e
`C` não são independentes para escrita apenas porque não se chamam diretamente.

Uma wave contém apenas tasks simultaneamente seguras. Para duas writers `A` e
`B`, todas as condições são obrigatórias:

1. nenhuma dependência direta ou transitiva;
2. `FILES_WRITE` conhecidos e disjuntos;
3. nenhum shared resource conflitante;
4. nenhum contrato produzido por uma e consumido pela outra;
5. nenhum estado/owner mutável compartilhado;
6. integração e validação posteriores definidas.

`WRITE(A) ∩ WRITE(B) = ∅` é necessário, não suficiente. Vale sempre:

```text
ONE_FILE + ONE_WRITER + PER_WAVE
```

Se o escopo de um worker alcançar arquivo de outro, ele retorna
`REPLAN_REQUIRED` antes de editar.

## Shared resources

Recursos centrais são detectados na task, não por lista fixa. Na baseline atual
incluem `package.json`, `package-lock.json`, `AGENTS.md`, docs/índices owners,
`index.js`, `App.js`, `src/navigation/MainNavigator.js`, `app.json`, `eas.json`,
`metro.config.js`, `src/firebaseConfig.js`, barrels compartilhados, schema
persistente, owners de estado como `activeRunState`/`activeRunRuntimeService` e
manifest/config Android.

Alterar arquivos distintos que dependem do mesmo schema, export, config,
navigator ou state owner continua sendo conflito semântico. Shared resource
normalmente serializa a wave; exceção exige evidência e integração explícitas.

## Read-only parallelism

Investigações e reviews podem ler o mesmo arquivo na mesma wave. Se as flags
justificarem, lifecycle, concurrency, persistence e geospatial podem revisar o
mesmo diff em paralelo. Cada task recebe pergunta e escopo distintos; não chame
todos por rotina.

Os specialists catalogados:

- investigam, verificam failure modes e produzem evidência;
- não editam, delegam, fazem commit, aprovam merge ou redefinem arquitetura;
- permanecem limitados ao diff/callers/testes necessários.

## Write parallelism

Antes de `S3`, registre `PARALLEL_WRITE_ELIGIBLE=YES` e a evidência para DAG,
files, shared resources e integração. Workers são agentes nativos, nunca custom
implementers. O prompt delegado contém escopo fechado, arquivos previstos,
dependências, validação e proibição de commit/push.

Use o menor `fork_turns` que preserve a intenção. Não herde ou cole histórico
completo por hábito: passe paths/symbols para leitura no owner e somente o
Learning Delta relevante. O brief mínimo e os modos de evidence pertencem a
[`token-economy.md`](token-economy.md); em Goal nativo,
`wayper-context-efficiency` aplica também o ceiling por classe. Nunca envie o
Working Context inteiro: envie somente outcome, scope, files/symbols,
constraints, risk, evidence, validation e Learning Delta relevante.

Sem isolamento, seja mais conservador. Não use `S3` quando houver file scope
desconhecido, contrato central, mesmo index Git, estado persistente comum ou
necessidade de decisão ainda aberta.

## Contrato de retorno

Handoff DONE não concede completion global. `planContextMapMerge()` propõe
findings OPEN, preserva owner review e declara `completionAuthority: NONE`.
O principal incorpora findings materiais pelo writer existente do Context Map
e solicita [CompletionAssessment](completion-boundary.md) antes de host DONE.

O contrato textual compacto abaixo permanece como fallback bounded quando o
packet ou handoff não puder ser preparado/validado:

```text
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED | REPLAN_REQUIRED
TASK_ID:
SUMMARY:
EVIDENCE:
FILES_INSPECTED:
FILES_CHANGED:
VALIDATION:
CONCERNS:
FOLLOW_UP:
```

Reviewer acrescenta `FINDINGS`. Cada finding exige:

```text
SEVERITY:
FILE:
LINE:
CLAIM:
FAILURE_SCENARIO:
EVIDENCE:
EXISTING_SAFEGUARD:
CONFIDENCE:
```

Sem cenário e evidência, não promover claim a bug confirmado. Read-only retorna
`FILES_CHANGED: none`. Finding fora do escopo vira `CONCERN`; o agent não edita.

Depois que o Decision Gate operacional autorizar `S1/S2` read-only e o profile
for escolhido pelo gate comportamental ou por receipt `ROUTER_SELECTED`,
`HARNESS_SPECIALIST_DISPATCH_V1` torna obrigatório o caminho
`Context Packet v1 -> specialist existente -> Structured Handoff v1 -> validator`.
`preparePacketizedSpecialist` produz o packet/receipt esperado e
`consumePacketizedSpecialist` valida o evento final; nenhum dos dois decide
`S0-S3`.
Essa troca de input/output não muda `S0-S3` e não
autoriza spawn. O orquestrador usa `fork_turns=none`, `readOnly=true`, zero
descendants, o target `nativeRole` ou TOML declarado no profile e o par
model/reasoning calculado pelo packet: risco/capability
crítica, `ARCHITECTURAL` ou `CRITICAL_RUNTIME` usa `gpt-5.6-sol/high`; `BUG` e
`INVESTIGATION` não críticos usam `gpt-5.6-terra/high`; `BOUNDED` não crítico
usa `gpt-5.6-terra/medium`; `TRIVIAL` não crítico usa
`gpt-5.6-luna/medium`. O receipt precisa coincidir com a policy registrada.
Source/config operacional com dispatch direto ou referência direta a profile
fora do adapter falha deterministicamente. Invocação manual externa permanece
`OUT_OF_BAND_UNENFORCEABLE`, pois não há interceptor/receipt assinado do runtime.
O handoff é JSON fechado, referencia evidence canônica por ID, registra reads e
source expansion, mantém `filesChanged=[]` e não carrega narrativa/transcript.
Somente o orquestrador calcula métricas e prepara um merge plan; somente o owner
do Context Map decide persistência. Completion inválida recebe no máximo uma
correção e depois aciona o fallback textual para o mesmo specialist já escolhido.
Packet inválido ou indisponível aciona o mesmo fallback antes da chamada. A
entrega final do subagent é o evento consumido; nenhum polling ou spawn recursivo
é autorizado.

## Políticas por risco/processo

- **`CRITICAL_RUNTIME`:** implementação no mesmo fluxo crítico é serial por
  default. Tracking, recovery, notification e finalization são
  interdependentes; use review `S1`/`S2` pelas flags. `S3` exige independência
  excepcional comprovada.
- **`ARCHITECTURAL`:** dependency/ownership map, interfaces, shared files e
  migration order vêm antes de write waves. Exploração read-only pode ser
  paralela; implementação espera design estabilizado.
- **`BUG`:** obtenha root cause antes de decompor. Reproduction, fix e tests não
  viram três writers simultâneas quando dependem da mesma causa.
- **`SAFE_REFACTOR`:** baseline/characterization e boundaries vêm primeiro.
  Comece serial em god objects; só paralelize extrações independentes com
  contratos públicos estáveis.
- **Validation:** paralelize testes apenas quando não disputarem device, porta,
  fixture, cache ou estado compartilhado e o ganho superar a coordenação.

## Synthesis

O agente principal não concatena outputs:

1. coleta e normaliza;
2. deduplica pela mesma causa + mesmo failure scenario;
3. confirma claims materiais no source/teste;
4. verifica safeguards existentes e confidence;
5. resolve divergências pela evidência, não por maioria;
6. descarta/rebaixa falsos positivos;
7. ordena por risco e decide bloqueio.

Em review `R3`, specialists permanecem independentes até essa síntese. Zero
findings é válido. O contrato completo de finding, severidade, confidence e
status está em [`quality-gates.md`](quality-gates.md).

Conflito de tasks para integração antes de continuar:

- `TEXTUAL_CONFLICT`: mesmas linhas/arquivo;
- `SEMANTIC_CONFLICT`: comportamento/contrato incompatível;
- `ARCHITECTURAL_CONFLICT`: ownership/boundary divergente;
- `SHARED_RESOURCE_CONFLICT`: config/schema/index/state comum.

Nenhum conflito é mesclado automaticamente sem entender o comportamento.

## Replanning, falha e stall

Retorne `REPLAN_REQUIRED` ao descobrir novo arquivo central/owner/risco,
migration, concurrency, API contract, writer concorrente ou dependência não
prevista. O principal pausa a área, atualiza a DAG, recalcula waves e mantém
somente tasks ainda independentes.

Falha de agent é `TOOL_FAILURE`, `CONTEXT_MISSING`, `TASK_AMBIGUOUS` ou
`ACTUAL_BLOCKER`. Faça no máximo um retry racional para falha transitória; não
crie loop. Para contexto faltante, forneça somente o delta; respostas repetidas
também omitem fatos/decisões inalterados. Se houver stall, o principal
interrompe, preserva evidence e replana; não existe daemon/timeout
custom do projeto.

Entre waves, propague somente deltas factuais relevantes como `NEW_FACTS`,
`NEW_PITFALLS`, `NEW_DEPENDENCIES`, `REJECTED_ASSUMPTIONS` ou `NEW_DECISIONS`;
não replique o histórico completo para tasks seguintes. Em Meta Goal, seleção,
relevância e não persistência seguem `meta-goal-runtime.md`; budget e conteúdo
do brief seguem `token-economy.md`.

## Git e worktrees

- Subagents não fazem commit, push, rebase nem disputam index Git.
- O principal integra, sintetiza e valida antes de criar commits autorizados.
- Use worktree somente quando escrita paralela grande e valiosa exige isolamento,
  os escopos são independentes e a integração está planejada.
- Não use worktree para trivial/bounded pequena, reviewer read-only ou cerimônia.
- O checkout atual não cria worktree automaticamente. Nenhum permanente é
  requisito do Harness.

Exemplo declarativo:

```text
WAVE 0 — READ
- T1 dependency/ownership map
- T2 independent failure-mode review

WAVE 1 — WRITE
- T3 depends on T1; single writer

WAVE 2 — REVIEW READ-ONLY
- R1 concurrency reviewer
- R2 lifecycle reviewer

WAVE 3 — SYNTHESIS + VALIDATION
- main agent dedupes, verifies and decides
```

Graphify pode apoiar `WAVE 0` quando o dependency map é amplo; permanece
discovery on-demand e source confirma qualquer claim. Os casos de aceitação e a
matriz de segurança estão em [`routing-evals.md`](routing-evals.md).
O router apenas emite a decisão de Graphify; execução de query/build continua
com o agente principal e sempre separada por repositório.

Context Packets permanecem views derivadas e nunca satisfazem o Decision Gate,
mudam `S0-S3`, criam agent ou substituem o contrato de decomposição. Quando o
fluxo operacional já decidiu chamar um specialist read-only catalogado, o
packet passa a ser seu input default; Goals sem specialist escolhido não recebem
packet automaticamente. `INDEPENDENT_REVIEW_PACKET` exclui
known-good e entradas marcadas `PRIOR_ANALYSIS_CONCLUSION` até a síntese, sem
ocultar failures/gaps objetivos não marcados; follow-up explícito usa
`FOLLOWUP_REVIEW_PACKET`. Structured Handoff v1 é o output default somente desse
boundary já selecionado; falha retorna ao contrato textual anterior. Receipt
`BEHAVIORAL_FALLBACK` nunca autoriza profile ou dispatch.

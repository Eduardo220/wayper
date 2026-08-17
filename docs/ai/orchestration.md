# Multi-Agent Orchestration — Wayper AI Harness V1

> **Status:** vigente<br>
> **Escopo:** delegação e waves no repositório mobile<br>
> **Owner:** [`docs/ai/harness-v1.md`](harness-v1.md)<br>
> **Router:** [`docs/ai/context-routing.md`](context-routing.md)<br>
> **Evals:** [`docs/ai/routing-evals.md`](routing-evals.md)

O agente principal do Codex é o único orquestrador. Multi-agent é opt-in por
valor; não é um tier de qualidade nem um passo obrigatório. Este protocolo é
declarativo: não existe Brain, planner executável, custom orchestrator ou
generic implementer/reviewer.

## Suporte observado e boundary de configuração

Na baseline de 2026-08-16, Codex CLI `0.147.0` expõe multi-agent estável,
subagents nativos, steering/interrupção e custom agents project-scoped em
`.codex/agents/`. A sessão atual oferece quatro slots totais, incluindo o agente
principal; a configuração global e o projeto não definem `[agents]` nem limite
próprio. O limite efetivo continua pertencendo ao runtime.

- Não fixe modelo ou reasoning tier automaticamente; os quatro specialists
  herdam a configuração aplicável e continuam read-only.
- Não versione limite de concorrência enquanto o default suportado e o cap do
  runtime forem suficientes. Como orientação, não exceda três a quatro agentes
  totais sem benchmark e nunca exceda o cap anunciado pela sessão.
- O runtime atual permite delegação aninhada, mas specialists Wayper não
  delegam. Workers nativos também não criam uma segunda hierarquia sem plano
  explícito do agente principal.
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
- `REAL_SPECIALIZATION`: um dos quatro specialists possui checklist pertinente;
- `REAL_PARALLELISM`: unidades independentes podem avançar simultaneamente;
- `INDEPENDENT_REVIEW`: perspectivas read-only reduzem risco concreto.

Considere também overhead de agente, contexto duplicado e síntese contra
speedup, isolamento, especialização e redução de risco. Se o valor líquido for
baixo ou incerto, use `S0`.

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

Os quatro specialists:

- investigam, verificam failure modes e produzem evidência;
- não editam, delegam, fazem commit, aprovam merge ou redefinem arquitetura;
- permanecem limitados ao diff/callers/testes necessários.

## Write parallelism

Antes de `S3`, registre `PARALLEL_WRITE_ELIGIBLE=YES` e a evidência para DAG,
files, shared resources e integração. Workers são agentes nativos, nunca custom
implementers. O prompt delegado contém escopo fechado, arquivos previstos,
dependências, validação e proibição de commit/push.

Sem isolamento, seja mais conservador. Não use `S3` quando houver file scope
desconhecido, contrato central, mesmo index Git, estado persistente comum ou
necessidade de decisão ainda aberta.

## Contrato de retorno

Todo subagent recebe `TASK_ID` e retorna de forma compacta:

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
```

Sem cenário e evidência, não promover claim a bug confirmado. Read-only retorna
`FILES_CHANGED: none`. Finding fora do escopo vira `CONCERN`; o agent não edita.

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

1. identifica conclusões comuns;
2. deduplica findings equivalentes;
3. confirma claims materiais no source/teste;
4. resolve divergências pela evidência, não por maioria;
5. descarta falso positivo;
6. ordena por risco e decide ação.

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
crie loop. Para contexto faltante, forneça somente o delta. Se houver stall, o
principal interrompe, preserva evidence e replana; não existe daemon/timeout
custom do projeto.

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

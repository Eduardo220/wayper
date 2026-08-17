# Process Workflows — Wayper AI Harness V1

> **Status:** vigente<br>
> **Escopo:** disciplina operacional transversal, carregada sob demanda<br>
> **Owner:** [`docs/ai/harness-v1.md`](harness-v1.md)<br>
> **Router:** [`docs/ai/context-routing.md`](context-routing.md)

Processo não é agent nem skill por padrão. O classifier escolhe o processo, a
skill acrescenta conhecimento do domínio e um specialist revisa risco concreto.
O agente principal continua executando descoberta, implementação e review
genéricos.

## Quality contract das skills

Uma skill project-scoped só merece existir quando resolve um problema de domínio
único e reduz redescoberta/erro. Sua metadata contém purpose, triggers e negative
triggers; o corpo on-demand contém preconditions, minimum context, workflow,
invariants, validation, escalation, specialist selection, output contract e
referências reais. Detalhes históricos/arquiteturais ficam em docs; checklist de
reviewer fica no custom agent; comportamento implementado fica em source/testes.

Não crie skill para repetir “investigue, implemente e teste”. Metadata nova exige
gatilho discriminativo, frequência/risco comprovado e economia maior que o custo
permanente.

## Decisões de workflow

| Candidato | Decisão | Motivo |
| --- | --- | --- |
| `BUG_INVESTIGATION` | `KEEP_AS_ROUTER_WORKFLOW` | Impede solution-first e exige causa/regressão, mas é transversal e não precisa de metadata própria |
| `SAFE_REFACTOR` | `KEEP_AS_ROUTER_WORKFLOW` | Sequência behavior-preserving é reutilizável; uma skill genérica duplicaria o Codex e as skills de domínio |
| `FEATURE_IMPLEMENTATION` | `KEEP_NATIVE` | `BOUNDED` + domain routing já fornece escopo, owner, validação e review leve |
| `CODE_REVIEW` | `KEEP_NATIVE` | Review genérico é nativo; somente o contrato de evidência é project policy |
| `PROJECT_SANITATION` | `KEEP_NATIVE` | Processo raro e genérico; classificar como bounded/investigation evita metadata permanente |
| `ARCHITECTURAL_CHANGE` | `KEEP_AS_ROUTER_WORKFLOW` | Exige estado, constraints, opções e migração, mas já nasce da classe `ARCHITECTURAL` |
| `CRITICAL_RUNTIME_CHANGE` | `MERGE_INTO_EXISTING_SKILL` | O workflow Wayper-específico pertence a `wayper-active-run`; outra skill duplicaria invariantes críticas |
| `TEST_FAILURE_INVESTIGATION` | `KEEP_AS_ROUTER_WORKFLOW` | Variante curta de investigação impede editar teste cegamente sem criar custom tester |
| `DOCUMENTATION_SYNC` | `KEEP_NATIVE` | Rename/link/doc update costuma ser trivial/bounded e não justifica workflow pesado |

Nenhum candidato obteve ROI para `CREATE_SKILL` nesta unidade.

## `BUG_INVESTIGATION`

Use quando há comportamento incorreto ou regressão verificável.

1. Preserve evidence/reproduction e o comportamento esperado.
2. Localize o owner e todos os callers relevantes.
3. Separe sintoma, causa e caminhos concorrentes/legados.
4. Formule uma causa falsificável e prove-a no source/teste/log.
5. Adicione ou ajuste a menor regressão que falhe pela causa, quando viável.
6. Corrija o owner compartilhado com o menor delta compatível.
7. Rode validação direcionada e amplie conforme flags/impacto.

Para bug simples de UI, esse fluxo permanece leve e não carrega skill/reviewer
pesado. Para `CRITICAL_RUNTIME`, componha com `wayper-active-run`, que acrescenta
lifecycle, invariantes e matriz crítica.

## `SAFE_REFACTOR`

Use somente quando o objetivo explícito é preservar comportamento.

1. Registre baseline observável e escopo não funcional.
2. Mapeie dependencies/consumers e boundaries atuais; use Graphify somente se o
   mapa for amplo/incerto.
3. Preserve ou crie characterization tests proporcionais ao risco.
4. Escolha a menor responsibility boundary que pode mudar isoladamente.
5. Faça um passo reversível, sem abstração especulativa ou feature escondida.
6. Compare comportamento/testes com a baseline antes do próximo passo.
7. Repita apenas enquanto cada passo mantiver evidência e rollback simples.
8. Rode regressão final e reporte qualquer risco não caracterizado.

Nome/typo/rename local não aciona este fluxo completo. Um refactor de
`MapScreen` é `ARCHITECTURAL` até dependency/ownership map provar fronteiras e
pode receber `CRITICAL_RUNTIME`; esta decisão não autoriza executá-lo.

## `ARCHITECTURAL_CHANGE`

Antes de editar:

1. descreva `CURRENT_STATE` e owners reais;
2. registre constraints/invariantes e consumers;
3. compare opções, inclusive manter o caminho atual;
4. escolha decisão e responsabilidade única;
5. defina migration/compatibility, failure modes e rollback;
6. implemente em fases pequenas com validação por boundary;
7. faça review especializado apenas pelas flags.

“Faça um plano” sem mudança de boundary não ativa este workflow.

## `TEST_FAILURE_INVESTIGATION`

1. Preserve erro, comando e baseline.
2. Determine se o contrato correto está no produto, no teste ou em ambos.
3. Localize a primeira divergência causal; não atualize assertion/snapshot para
   fazê-lo passar.
4. Corrija o owner correto e rode o teste direcionado.
5. Amplie a suíte quando o impacto justificar.

Snapshot quebrado não implica automaticamente bug de produção nem autorização
para aceitar output novo.

## Workflows nativos com gates Wayper

- **Feature bounded:** confirme autorização/regra, reutilize owner/pattern,
  implemente o menor delta, valide e faça review leve. Não crie `wayper-feature`.
- **Code review:** reporte apenas bug, regressão, violação arquitetural, risco
  concreto ou validação ausente. Cada finding exige `FILE/LINE`, `SEVERITY`,
  `CLAIM`, `FAILURE_SCENARIO` e `EVIDENCE`; sem cenário/evidência, não chame de
  bug. Use specialists existentes pelas flags, nunca generic reviewer custom.
- **Project sanitation:** inventarie/baseline, classifique cada remoção, limpe em
  passos reversíveis e compare before/after. Para imports locais óbvios, use
  apenas `BOUNDED` e validação direcionada.
- **Documentation sync:** confirme rename/owner/consumers, atualize links/fontes
  afetadas e valide referências. Não carregue domínio técnico sem impacto real.

## Orchestration boundary

O processo estabiliza causa, owner e sequência antes de qualquer decomposition.
Use [`docs/ai/orchestration.md`](orchestration.md) somente quando isolamento,
especialização, paralelismo real ou review independente acrescentarem valor.

- `BUG_INVESTIGATION`: root cause vem antes de separar reproduction/fix/tests.
- `ARCHITECTURAL_CHANGE`: exploração read-only pode ser paralela; writes esperam
  ownership, interfaces, shared files e migration order estáveis.
- `SAFE_REFACTOR`: baseline e boundaries são seriais no início; extrações só
  compartilham wave quando independentes e behavior-preserving.
- `CRITICAL_RUNTIME`: `wayper-active-run` concentra o workflow; implementação do
  mesmo fluxo é serial por default e reviewers podem compor wave read-only.

O modo de orquestração não reclassifica a tarefa nem cria process skill. Se file
scope ou dependência forem desconhecidos, investigar primeiro.

## Composition

Componha apenas arquivos que acrescentem informação:

```text
TASK CLASS + DOMAIN SKILL + PROCESS + ORCHESTRATION MODE + SPECIALIST BY FLAG
```

Exemplos:

- UI bug: `BUG + UI_DESIGN + BUG_INVESTIGATION`; nenhuma skill/reviewer pesado.
- Background run bug: `BUG + RUN_RUNTIME + BUG_INVESTIGATION +
  wayper-active-run + lifecycle/concurrency reviewers` conforme flags.
- Behavior-preserving `MapScreen`: `ARCHITECTURAL + RUN_RUNTIME + SAFE_REFACTOR
  + wayper-active-run`; Graphify e reviewers somente após mapear risco.
- Small social feature: `BOUNDED + SOCIAL + native feature workflow`; persistence
  skill apenas se contrato durable/sync mudar.

Se a domain skill já contém o override específico — como critical runtime em
`wayper-active-run` — não carregue outro arquivo para repetir a mesma sequência.

## Output contracts internos

Esses campos disciplinam tarefas complexas; não precisam aparecer na resposta.

```text
BUG: EVIDENCE | ROOT_CAUSE | REGRESSION | FIX | VALIDATION
SAFE_REFACTOR: BASELINE | BOUNDARY | STEP | BEHAVIOR_CHECK | RESULT
ARCHITECTURAL: CURRENT_STATE | CONSTRAINTS | OPTIONS | DECISION | MIGRATION | VALIDATION
REVIEW: FINDINGS | RISKS | TEST_GAPS
```

Comandos vêm do `package.json` atual. `npm run lint` é canônico; typecheck não
existe. Não invente build/test e registre qualquer ausência.

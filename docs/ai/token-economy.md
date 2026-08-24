# Token Economy — Wayper AI Harness

> **Status:** vigente<br>
> **Escopo:** contexto, leitura, tool output e síntese do Harness<br>
> **Owner:** [`harness-v1.md`](harness-v1.md)<br>
> **Router:** [`context-routing.md`](context-routing.md)<br>
> **Evals:** [`routing-evals.md`](routing-evals.md)

## Princípio

```text
OPTIMIZE WASTE, NOT REASONING
```

Economia nunca reduz investigação causal, validação, segurança, acessibilidade,
proteção de dados, quality gate ou evidência necessária. Bytes menores são uma
métrica operacional; não provam menos tokens faturados, mais cache hit ou mesma
qualidade. Quando compressão cria ambiguidade, preserve clareza ou conteúdo
exato.

Esta política não cria proxy, hook, agent, skill, memória, daemon ou configuração
project-scoped. RTK, Caveman e preferências do Codex continuam `USER_GLOBAL`; o
projeto apenas decide quando a saída comprimida é segura.

## Modos

| Mode | Use | Preserve | Não usar para |
| --- | --- | --- | --- |
| `COMPACT` | descoberta, status, comando verde, síntese repetitiva e briefing bounded | exit code, contagens, decisão, blocker e próximo passo | apagar warning/failure material ou detalhe necessário |
| `CLEAR` | decisão, sequência, conflito, risco, rollback e explicação que pode ser mal interpretada | linguagem completa e ordem explícita | inflar narrativa, repetir histórico ou despejar logs |
| `EXACT` | JSON/NDJSON, diff, stack/error decisivo, log diagnóstico, output de auditoria, coordenadas e evidência machine-readable | bytes/estrutura/ordem relevantes do producer | filtros que truncam, reformatam ou resumem silenciosamente |

Os modos compõem a mesma tarefa. Exemplo seguro: busca ampla em `COMPACT`,
source/caller decisivo em `EXACT` e conclusão em `CLEAR`. Um pedido explícito de
raw/exato seleciona `EXACT`; risco ou ambiguidade seleciona `CLEAR` mesmo quando
`COMPACT` seria menor.

## Contexto progressivo

Comece pelo menor artefato que pode responder e expanda somente por lacuna real:

1. localize arquivo, símbolo, caller, import ou heading com `rg`;
2. leia o símbolo/heading e poucas linhas de contexto;
3. expanda até cobrir control flow, invariantes e failure path relevantes;
4. leia callers/consumers e testes diretamente causais;
5. abra o arquivo inteiro somente quando ele for pequeno ou a semântica realmente
   atravessar o arquivo;
6. suba para docs/domínios/Graphify/specialist apenas pelo router e risco.

Linha isolada não prova comportamento. Range não pode cortar `try/catch`, cleanup,
branch, state transition, import que muda semântica ou teste necessário. Arquivo
grande não autoriza leitura cega completa nem recorte inseguro: use o outline
(`rg` por exports/functions/headings), encontre boundaries atuais e amplie até a
prova ficar suficiente.

Para source e evidence, prefira leitura raw por range. Output comprimido de `rg`
é discovery; qualquer claim material volta ao source exato. Graph, cache, search
snippet e resumo nunca substituem o owner atual.

## Tool output

Todo comando preserva exit code. Em sucesso, retenha somente resumo causal:
status, contagem, duração quando útil e warning material. Em falha, retenha o
menor trecho decisivo e abra detalhes exatos sob demanda; não esconda primeiro
erro, stack causal, arquivo/linha, signal, timeout ou partial-success relevante.

RTK observado oferece caminhos diferentes, portanto escolha pelo contrato:

- `rtk rg ...` para discovery amplo; confirme matches decisivos com raw;
- `rtk npm run <gate>` para remover boilerplate de scripts;
- `rtk test npm test -- --runInBand` para suíte verde compacta, preservando
  failures se existirem;
- `rtk proxy <command>` quando `EXACT` for necessário;
- JSON usado por parser ou auditoria permanece raw; uma query estrutural com
  `jq` é permitida quando o filtro é explícito e o exit code upstream é
  preservado.

O adapter global pode reescrever comandos, mas não é garantia do projeto. Um
filtro que omite evidence necessária recebe retry raw; não se conclui que o
producer falhou ou passou pela ausência de texto filtrado.

## Caveman

Caveman é camada global de model output, não compressor de source nem regra
Wayper. O uso ideal é `COMPACT` para updates e sínteses rotineiras quando números,
negações, termos, erros e código permanecem exatos. Use `CLEAR` para sequência,
decisão, segurança, irreversibilidade ou ambiguidade. Conteúdo persistido em
docs, código, comentário, commit ou mensagem externa continua em prosa normal.

A instalação auditada declara cerca de 65% de redução de output, mas a própria
documentação classifica isso como benchmark/estimativa e estima overhead de
1.250 input tokens por turn. O hook de receipt `caveman-stats` não está ativo no
Codex auditado; portanto a sessão não reivindica economia líquida medida. Não
copie Caveman para o projeto e não o ative por default permanente da Wayper.

## Subagents e Learning Delta

`S0` continua default e custa `SUBAGENT_BRIEF_BYTES=0`. Quando delegação já foi
autorizada e o gate de [`orchestration.md`](orchestration.md) passa:

- use o menor `fork_turns` que preserve a intenção; não herde histórico completo
  por hábito;
- envie outcome, pergunta/change, scope, arquivos/símbolos, constraints,
  evidence esperada e validation;
- não cole source, AGENTS, docs ou output que o agent pode abrir no owner;
- entre waves, acrescente somente `NEW_FACTS`, `NEW_PITFALLS`,
  `NEW_DEPENDENCIES`, `REJECTED_ASSUMPTIONS` e `NEW_DECISIONS` relevantes;
- omita campos vazios e facts deriváveis; mantenha findings/evidence em `EXACT`.

Brief mínimo:

```text
TASK_ID | OUTCOME | SCOPE | FILES_OR_SYMBOLS | EVIDENCE_NEEDED
CONSTRAINTS | VALIDATION | RELEVANT_LEARNING_DELTA
```

O retorno compacto de orchestration permanece válido. Redução de briefing não
autoriza perder constraint, risk flag, dependency, shared resource, rollback ou
critério de aceite.

## Memory e compactação nativa

Repo memory continua `0` bytes por default. Tarefa trivial/bounded não relacionada
não abre index; lookup e promotion seguem
[`memory-policy.md`](memory-policy.md). Compaction de conversa não é memória,
source of truth nem autorização para promover Learning Delta.

Na auditoria de 2026-08-23, `codex-cli 0.149.0` mostrou
`remote_compaction_v2=stable/true`, `enable_request_compression=stable/true`,
`local_thread_store_compression=under-development/false` e nenhum subcomando
CLI `compact`. O catálogo bundled do modelo ativo expôs context window efetiva,
mas não um threshold público de auto-compaction. A
[documentação oficial](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.2)
confirma `POST /v1/responses/compact` e itens opacos para continuidade de
workflows; isso não prova quando ou como a superfície Codex atual compacta uma
thread.

Decisão: aceitar compaction nativa quando o runtime a aplicar, sem hook ou
fallback project-scoped. Após milestone/compaction, revalidar estado material
contra Git/source/testes, preservar constraints e continuar pelo resumo compacto
de Meta Goal. Nunca baixar reasoning effort só para economizar tokens.

## Contabilidade

| Métrica | Definição | Claim permitido |
| --- | --- | --- |
| `PERMANENT_CONTEXT_BYTES` | bytes model-visible/project-scoped carregados antes da task | crescimento byte a byte; não billed tokens |
| `ON_DEMAND_CONTEXT_BYTES` | bytes dos arquivos/ranges realmente selecionados | proxy de prompt/context savings |
| `TOOL_OUTPUT_RAW` | stdout/stderr raw produzido pelo mesmo comando | bytes/linhas observados |
| `TOOL_OUTPUT_OPTIMIZED` | output após filtro, com mesmo cenário/exit | bytes/linhas observados e delta |
| `SUBAGENT_BRIEF_BYTES` | briefing explicitamente enviado; `0` em `S0` | não inclui overhead oculto/runtime |
| `FINAL_OUTPUT_BYTES` | resposta final UTF-8 observada | model output bytes, não tokens |

Sempre separe `PROMPT/CONTEXT SAVINGS`, `TOOL OUTPUT SAVINGS` e `MODEL OUTPUT
SAVINGS`. `TOTAL SESSION` fica `UNKNOWN` salvo receipt do provider. RTK `gain`,
estimativa Caveman, bytes, chars e tokens de tokenizer local não são faturamento.

## Baseline e benchmarks

Medição local de 2026-08-23. Todos os pares de tool output mantiveram exit `0`;
T3 comprimido é somente discovery e T1 exige raw em `EXACT`. Percentuais são
redução de bytes, arredondados a uma casa.

| Task | Cenário | `ON_DEMAND_CONTEXT_BYTES` before / after | `TOOL_OUTPUT_RAW` / `OPTIMIZED` | Resultado |
| --- | --- | ---: | ---: | --- |
| T1 `TRIVIAL` | localizar copy em `MapScreen` | 268.979 / 3.888 | 300 / 299 | contexto -98,6%; output -0,3% |
| T2 `BOUNDED` | owner + teste de formatter do backstop | 16.688 / 1.466 | 200 / 170 | contexto -91,2%; output -15,0% |
| T3 `BUG/INVESTIGATION` | scope/callers/testes do backstop + owner doc | 33.179 / 11.940 | 967.137 / 18.546 | contexto -64,0%; output -98,1% |
| T4 `CRITICAL/META LONGA` | Harness/tool audit + full Jest | 201.340 / 38.036 | 4.414 / 82 | contexto -81,1%; output -98,1%; 56 suites/623 testes verdes |

`PERMANENT_CONTEXT_BYTES` model-visible da Wayper foi 7.311 B antes da unidade;
`AGENTS.md` e metadata de skills/agents não mudam, logo o target AFTER é 7.311 B
(`0%`). `SUBAGENT_BRIEF_BYTES` desta execução foi `0`, pois permaneceu `S0`.
`FINAL_OUTPUT_BYTES` é medido na conclusão, sem estimar billed tokens.

Auditoria real das ferramentas:

| Tool/capability | Evidência observada | Interpretação |
| --- | --- | --- |
| RTK `0.45.0` | 4.906 commands; 27,6M input proxy; 6,8M output; 20,8M/75,5% estimated saved | histórico global, não receipt de billing |
| RTK hook | adapter Codex global ativo; `rtk gain` também reportou shell hook próprio ausente | scopes distintos; nenhuma mudança project-scoped |
| Caveman | skill/README global presentes; plugin/hook de stats ausente no Codex | 65% não verificado nesta sessão; possível overhead líquido negativo |
| Native compaction | features locais acima + contrato oficial de Responses API | disponível no runtime, timing/threshold da thread `UNKNOWN` |

Reprodução mínima usa `wc -c`, ranges `sed`, exit codes e os mesmos comandos raw
via `rtk proxy`. Resultados machine-readable permanecem em `EXACT`; não se
versiona log bruto nem cache de benchmark.

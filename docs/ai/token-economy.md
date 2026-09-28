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

Esta política compõe com a skill project-scoped `wayper-context-efficiency` e o
helper determinístico de fingerprints/benchmark. Eles não criam proxy, hook,
agent, memória, daemon ou configuração global. RTK, Caveman e preferências do
Codex continuam `USER_GLOBAL`.

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

Em Goal nativo, consulte primeiro o Working Context/`CONTEXT_MAP`: reuse proof com fingerprint
igual e abra o diff antes do arquivo quando ele mudou. Depois, comece pelo menor
artefato que pode responder e expanda somente por lacuna real:

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

## Working Context e budgets por classe

[`working-context.md`](working-context.md) persiste fingerprints, requirements,
evidence e Learning Delta em Markdown por Goal. Ele separa quatro decisões:

```text
KNOWN_GOOD_UNCHANGED -> reuse sem reread
REUSE_BEFORE_READ -> discovery reutilizável, proof ainda necessário
DIFF_BEFORE_FILE -> diff e fluxo afetado antes do arquivo inteiro
READ_REQUIRED -> menor range suficiente
```

O ceiling inicial de contexto usa proxy explícito `ceil(UTF-8 bytes / 4)`:
`TRIVIAL 1.500`, `BOUNDED 4.000`, `BUG 8.000`, `INVESTIGATION 10.000`,
`ARCHITECTURAL 16.000`, `CRITICAL_RUNTIME 24.000`. Brief de subagent recebe
respectivamente `0`, `0`, `800`, `800`, `1.200`, `1.600` unidades, somente se o
gate de orchestration já autorizou delegação. O proxy não é receipt/billing.
Evidence necessária excede o ceiling com motivo; nunca é removida para passar.

Context Packets derivam ceilings por classe e tipo de target a partir desses
ceilings (`agentProfile /4`, `nativeRole /3`, `capabilitySet /5`,
`validationRole /3`, floor 256). São limites proxy iniciais, validados pelo
corpus; contexto optional é removido deterministamente primeiro e registrado
como ambiguidade. `OVER_BUDGET` de contexto necessário exige motivo explícito e
nunca trunca evidence necessária.

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

## Discovery de skills e Capability Closure

A [documentação oficial do Codex](https://learn.chatgpt.com/docs/build-skills)
confirma progressive disclosure: o runtime inicia com `name`, `description` e
path de cada skill, carrega o `SKILL.md` completo somente ao selecionar a skill e
limita a lista inicial a 2% da context window ou 8.000 caracteres quando a janela
é desconhecida. Em listas grandes, descriptions podem ser reduzidas e skills
podem ser omitidas com warning. Portanto bodies são on-demand, mas metadata não
é gratuita.

[`capability-registry.json`](capability-registry.json) fica on-demand e permite
discovery hierárquico quando o catálogo crescer: domain/capability primeiro,
asset depois. Ele não adiciona skill bootstrap, metadata ou linha ao
`AGENTS.md`. A seleção e Context Closure pertencem a
[`capability-architecture.md`](capability-architecture.md).

Baseline da Unidade 15, reproduzida por `npm run quality:capabilities` e
`npm run quality:design`:

| Métrica | Before U15 | After U15 |
| --- | ---: | ---: |
| `TOTAL_CAPABILITIES` canônicas | 43 | 54 |
| `ACTIVE_SKILLS` | 4 | 4 |
| `REGISTRY_BYTES` on-demand | 9.994 B | 11.750 B |
| `PERMANENT_DISCOVERY_BYTES` das quatro skills | 1.074 B | 1.074 B |
| `ON_DEMAND_SKILL_BODY_BYTES` disponíveis | 12.872 B | 12.872 B |
| `PERMANENT_CONTEXT_BYTES` Wayper | 7.311 B | 7.311 B |
| routing evals declarativas | 294 | 306 |

`PERMANENT_DISCOVERY_BYTES` conta UTF-8 de name + description + path absoluto
observado das skills do projeto, sem estimar formatação/overhead do runtime; é
subconjunto do contexto permanente, não valor somável a 7.311 B. O path torna o
número dependente do checkout, por isso o validator remede em cada ambiente.

Nas 12 fixtures de closure: `SKILLS_LOADED_PER_TASK` foi 0–2 (média 0,33),
`COMPOSED_CONTEXT_BYTES` foi 0–15.065 B (média 6.680 B),
`IRRELEVANT_SKILL_LOADS=0` e `MISSED_CAPABILITIES=0`. Precision/recall do working
set foram 100% contra expectations declarativas; isso prova composição do
resolver por evidence, não classificação semântica autônoma de linguagem.

A simulação em memória usa catálogo de 70 capabilities, seleciona
`weekly-ranking + xp-progression` e carrega somente essas duas capabilities,
zero skill bodies e 5.887 B de reference deduplicada. Nenhuma capability ou skill
falsa é persistida.

### Design Intelligence

As 11 capabilities novas e a capability de UI anterior compartilham uma única
reference on-demand. `DESIGN.md` é contrato; `WayperTheme` continua owner dos
valores executáveis. Nenhuma skill, hook, plugin ou linha permanente foi criada.

| Métrica | Before U15 | After U15 |
| --- | ---: | ---: |
| `DESIGN_REGISTRY_BYTES` | 0 B | 1.493 B |
| `DESIGN_SKILL_METADATA_BYTES` | 0 B | 0 B |
| `DESIGN_ON_DEMAND_BYTES` | 0 B | 19.372 B |
| `PERMANENT_CONTEXT_DELTA` | 0 B | 0 B (0%) |
| design routing evals | 0 | 12 |
| irrelevant design skill loads | 0 | 0 |

`DESIGN_REGISTRY_BYTES` serializa de forma compacta somente assets e
capabilities `UI_DESIGN`; não é o tamanho do registry completo.
`DESIGN_ON_DEMAND_BYTES` é o tamanho real de `DESIGN.md` e é deduplicado mesmo
quando uma task seleciona várias capabilities. Nos casos copy-only, runtime bug
e refactor genérico o working set visual é `0 B`. Bytes não são billed tokens.

### External Skill Acquisition

Baseline da Unidade 16, reproduzida por `npm run quality:capabilities` e pelo
trial datado em
[`2026-08-24-external-skill-ecosystem.md`](../audits/2026-08-24-external-skill-ecosystem.md):

| Métrica | Before U16 | After U16 |
| --- | ---: | ---: |
| `TOTAL_CAPABILITIES` canônicas | 54 | 55 |
| `ACTIVE_SKILLS` project-scoped | 4 | 4 |
| `REGISTRY_BYTES` on-demand | 11.750 B | 12.111 B |
| `PERMANENT_CONTEXT_BYTES` Wayper | 7.311 B | 7.311 B |
| `EXTERNAL_DISCOVERY_PERMANENT_BYTES` | 0 B | 0 B |
| `FIND_SKILLS_METADATA_BYTES` user-global observado | 363 B | 363 B |
| `ACQUISITION_POLICY_BYTES` on-demand | 0 B | 8.936 B |
| `TRIAL_CONTEXT_BYTES` | 0 B | 5.615 B |
| `PROVENANCE_BYTES` on-demand | 0 B | 95 B |

Find Skills já existia em `USER_GLOBAL`; seus 363 B não pertencem ao contexto
permanente project-scoped e não são delta desta unidade. Policy, evals e ledger
ficam on-demand; nenhum `SKILL.md`, agent metadata, hook ou linha de `AGENTS.md`
foi acrescentado. `TRIAL_CONTEXT_BYTES` mede o prompt exato emitido pelo CLI,
não billed tokens. O ledger vazio evita inventar promoção para provar o pipeline.

### Evidence-Gated Completion

Na ativação de 2026-08-24, o recorte comparável da foundation — `AGENTS.md` +
`name/description` das quatro skills + `name/description` dos quatro agents —
foi medido byte a byte:

| Métrica | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `AGENTS.md` | 59 linhas / 2.968 B | 60 linhas / 3.046 B | +1 linha / +78 B |
| skill metadata | 4 / 787 B | 4 / 787 B | 0 B |
| agent metadata | 4 / 569 B | 4 / 569 B | 0 B |
| permanent context total deste recorte | 4.324 B | 4.402 B | +78 B / +1,8% |

A única linha permanente acrescentada seleciona completion baseado em evidence e
declara budgets como tetos. Contrato, matriz, evals e report permanecem on-demand.
`PERMANENT_DISCOVERY_BYTES`, que também inclui paths absolutos das skills, ficou
1.074 B before/after e não é somado novamente ao recorte acima.

### Context Efficiency

Ativação de 2026-08-24, reproduzida por `npm run quality:context` e
`npm run quality:capabilities`:

| Métrica | Before | After | Delta |
| --- | ---: | ---: | ---: |
| capabilities canônicas | 55 | 56 | +1 |
| skills project-scoped | 4 | 5 | +1 transversal |
| registry on-demand | 12.111 B | 12.475 B | +364 B |
| bodies de skill on-demand | 12.872 B | 20.263 B | +7.391 B |
| discovery payload com paths | 1.074 B | 1.417 B | +343 B |
| `AGENTS.md` | 3.046 B | 3.174 B | +128 B |
| metadata `name+description` | 787 B | 1.053 B | +266 B |
| recorte permanente comparável | 4.402 B | 4.796 B | +394 B / +8,9% |
| contexto benchmark (3 casos) | 349.859 B | 71.729 B | -79,5% |
| `CONTEXT_TOKEN_PROXY` | 87.469 | 17.938 | -79,5% |

O recorte permanente soma `AGENTS.md`, metadata das skills e 569 B dos quatro
agents, inalterados. O benchmark mede artifacts/ranges reais do Harness e exige
preservação/superset declarada de tests, validations, risk flags e invariants.
Por caso: bounded `-89,6%`, architectural `-68,5%` e critical runtime `-83,0%`.
O proxy é operacional; billed/session tokens continuam `UNKNOWN` sem receipt.
Nenhum subagent foi usado na implementação (`S0`, brief `0 B`).

### Deterministic Capability Router — Shadow

Baseline local de 2026-08-31, reproduzida por `npm run quality:router`:

| Métrica | Resultado |
| --- | ---: |
| registry canônico on-demand | 16.145 B |
| router / testes / corpus on-demand | 33.793 / 12.216 / 19.133 B |
| evals SHADOW | 18/18 PASS |
| capability precision / recall | 100% / 100% |
| profile precision / coverage / redundancy | 100% / 100% / 0 |
| output JSON agregado | 49.702 B |
| candidates / selected profiles | 15 / 11 |
| estimated context cost agregado | 19.424 token-proxy |
| LLM calls / agents spawned / Graphify executions | 0 / 0 / 0 |

O registry cresceu somente com quatro declarações `repositories: ["wayper"]`;
nenhuma capability, skill ou profile novo foi criado. Router, testes, fixture e
logs opcionais são on-demand, logo `PERMANENT_CONTEXT_BYTES` ficou inalterado.
Tempo é medido a cada execução e reportado como performance local, nunca como
latência do runtime ou receipt de provider.

### Capability-scoped Context Packets — Shadow

Baseline local de 2026-09-01, reproduzida por `npm run quality:packets`:

| Métrica | Resultado |
| --- | ---: |
| evals / packets SHADOW | 20/20 PASS / 22 |
| broad context baseline / packet payloads | 526.962 B / 24.112 B |
| redução agregada | 95,4% |
| redução p50 / p90 | 95,7% / 96,2% |
| best / worst | 100,0% zero-specialist / 88,2% shared evidence em três packets |
| evidence / capability / proof-gap coverage | 100% / 100% / 100% |
| source materialized pelos packets | 0 B |
| router ativado / packets injetados / agents executados | 0 / 0 / 0 |

O baseline broad soma mapa, registry, router output e source bytes que seriam
materializados sem filtering; o packet contém refs. `sourceBytesReferenced` não
é `sourceBytesMaterialized`. Dedupe conta unique/repeated refs e bytes
hipoteticamente duplicados sem o mapa; não afirma cache hit nem billing evitado.

Telemetria Goal-scoped reporta somente observáveis locais. Reads completos/range
sem instrumentação suportada ficam `UNKNOWN`; provider usage entra apenas por
interface suportada fornecida pelo host. A documentação oficial do Codex expõe
`/status` para uso da sessão e `/usage` para atividade da conta, mas não fornece
nesse contrato público attribution machine-readable por Goal/turn/subagent
([Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)).
O SDK público documenta thread/run, sem prometer esses campos no result
([Codex SDK](https://learn.chatgpt.com/docs/codex-sdk)). O Harness não lê UI nem
arquivos internos; ausência vira `PROVIDER_ATTRIBUTION_UNAVAILABLE`.

### Structured Handoff + packetized runtime canary

Baseline local de 2026-09-01: um control e um canary usaram o mesmo
`wayper_geospatial_reviewer` e a mesma pergunta sobre
`src/utils/zones.js#L37-L92`. O control usou `fork_turns=all`; o canary usou
`fork_turns=none`, Context Packet explícito, read-only e sem descendants.

| Métrica | Control | Canary |
| --- | ---: | ---: |
| payload explícito observável | brief 674 B / 169 proxy + history `UNKNOWN` | packet 2.096 B / 524 proxy + framing/bootstrap `UNKNOWN` |
| resultado | narrativa 2.786 B / 697 proxy | handoff validado 3.864 B / 966 proxy |
| findings | 3 | 3 |
| findings em comum | 2 | 2 |
| files/ranges declarados | 5, com expansão ampla | 1 packet-scoped |
| out-of-packet | 4 arquivos mais expansão do target | 0 |
| testes | 1 source probe | 0 |
| proof gaps | 2 runtime/external | 1 range incompleto |
| correction attempts / invalid handoffs | n/a | 1 / 1 |
| writes / recursive spawns | 0 / 0 | 0 / 0 |
| wall time / provider per-agent usage | `UNKNOWN` | `UNKNOWN` |

O control confirmou callers/safeguards e encontrou collinearidade fora do range;
o canary encontrou coerção de string vazia, mas retornou corretamente `PARTIAL`
porque o packet cortou `isValidPolygon`. Portanto os dois preservaram o número
de findings, mas não a mesma coverage. O input observável de source caiu e a
herança da parent conversation foi removida no canary; o output proxy cresceu
38,7%. O total de input continua incomparável porque bootstrap e history não têm
receipt de bytes/tokens. Veredicto: `IMPROVED_WITH_LIMITED_RUNTIME_EVIDENCE`, sem
claim de billing nem de runtime packetizado forte.

Hidden-context audit:

| Fonte | Control | Canary | Classe | Medição |
| --- | --- | --- | --- | --- |
| Context Packet | ausente | explícito | `TARGET_PACKET` | 2.096 B |
| parent history / conversation | presente e auto-reportada | excluída por `fork_turns=none` | `INHERITED_HISTORY` | bytes `UNKNOWN` |
| project/global AGENTS e RTK | esperado pelo runtime | esperado pelo runtime | `REQUIRED_BOOTSTRAP` | payload serializado `UNKNOWN` |
| system/developer/Codex bootstrap | presente | presente | `UNAVOIDABLE_RUNTIME` | `UNKNOWN` |
| profile TOML/role | mesmo profile | mesmo profile | `REQUIRED_BOOTSTRAP` | `UNKNOWN` |
| skills de domínio | territory skill lida pelo control | possível carga automática | `OPTIONAL_SKILL` | `UNKNOWN` |
| Ponytail/plugin lifecycle | presente | presente | `UNAVOIDABLE_RUNTIME` | `UNKNOWN` |
| outras injections | não enumeráveis pela interface | não enumeráveis pela interface | `UNKNOWN` | `UNKNOWN` |

`fork_turns=none` prova ausência de parent turns no payload delegado, não mede
bootstrap oculto. Se uma surface ignorar essa opção ou reenviar history, o
veredicto volta a `IMPROVED_PROXY_ONLY` até nova evidência.

## Contabilidade

| Métrica | Definição | Claim permitido |
| --- | --- | --- |
| `PERMANENT_CONTEXT_BYTES` | bytes model-visible/project-scoped carregados antes da task | crescimento byte a byte; não billed tokens |
| `TOTAL_CAPABILITIES` | entries canônicas no registry on-demand | tamanho da biblioteca, não tamanho do working set |
| `ACTIVE_SKILLS` | assets `SKILL` ativos no registry | inventário, não ativações por task |
| `REGISTRY_BYTES` | tamanho UTF-8 do registry on-demand | custo do catálogo quando aberto |
| `PERMANENT_DISCOVERY_BYTES` | payload observado de name + description + path das skills | proxy local; não inclui overhead do runtime |
| `ON_DEMAND_CONTEXT_BYTES` | bytes dos arquivos/ranges realmente selecionados | proxy de prompt/context savings |
| `SKILLS_LOADED_PER_TASK` | bodies de skill distintos na Context Closure | escala do working set |
| `COMPOSED_CONTEXT_BYTES` | bytes deduplicados dos assets selecionados pela fixture | não inclui source ranges/runtime overhead |
| `IRRELEVANT_SKILL_LOADS` | skill body carregado fora do expected working set | waste do router |
| `MISSED_CAPABILITIES` | capability esperada ausente da closure | recall failure do router |
| `TOOL_OUTPUT_RAW` | stdout/stderr raw produzido pelo mesmo comando | bytes/linhas observados |
| `TOOL_OUTPUT_OPTIMIZED` | output após filtro, com mesmo cenário/exit | bytes/linhas observados e delta |
| `SUBAGENT_BRIEF_BYTES` | briefing explicitamente enviado; `0` em `S0` | não inclui overhead oculto/runtime |
| `FINAL_OUTPUT_BYTES` | resposta final UTF-8 observada | model output bytes, não tokens |
| `CONTEXT_TOKEN_PROXY` | `ceil(UTF-8 bytes / 4)` dos artifacts declarados | comparação reproduzível; não provider receipt |
| `KNOWN_GOOD_UNCHANGED` | artifact com proof e fingerprint idêntico | reuse scoped; não verdade do produto |
| `INVALIDATED_CONTEXT` | artifacts cujo fingerprint mudou | invalidação localizada, não reset global |
| `ESTIMATED_ROUTER_CONTEXT_COST` | proxy determinístico dos assets/TOML dos profiles recomendados | comparação SHADOW; não billed tokens nem spawn real |
| `PACKET_BYTES` / `PACKET_TOKEN_PROXY` | JSON derivado realmente construído e `ceil(bytes/4)` | payload SHADOW; não prompt enviado nem billing |
| `SOURCE_BYTES_REFERENCED` | bytes dos sources apontados pelas evidence refs | referência potencial; não materialização |
| `SOURCE_BYTES_MATERIALIZED` | inline source realmente presente no packet | `0` nesta fase reference-only |
| `DUPLICATED_BYTES_AVOIDED` | duplicação hipotética de source quando refs compartilhadas fossem blobs | proxy de dedupe; não cache/provider savings |
| `HANDOFF_BYTES` / `HANDOFF_TOKEN_PROXY` | JSON final validado e `ceil(bytes/4)` | output payload; não billing nem reasoning tokens |
| `CONTROL_PAYLOAD_PROXY` / `CANARY_PAYLOAD_PROXY` | componentes explicitamente observáveis de input | total fica `UNKNOWN` quando history/bootstrap não são medidos |
| `CONTROL_RESULT_PROXY` / `CANARY_HANDOFF_PROXY` | bytes/4 dos outputs observados | compara output local, não provider usage |

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

### Graphify ROI

Unidade 17 manteve `AGENTS.md` e metadata de skills/agents intactos:
`PERMANENT_CONTEXT_BYTES` ficou 7.311 B before/after (`0 B`, `0%`). Policy,
evals e auditoria são on-demand. O índice shared medido ocupava 66.898.904 B;
o cold code-only levou 15,08 s/329 MB. O candidato app-only ocupou 5.502.553 B,
levou 7,34 s/262 MB no cold e reduziu a query warm mediana de 0,64 s/74 MB
para 0,41 s/61 MB. Esses bytes/tempos são custo local, não billed tokens.

A decisão `RECONFIGURE` removeu dois hooks Git e reteve apenas uso app-only
explícito. Launch foreground era 0,05–0,06 s, mas os rebuilds observados
custaram 10,46–16,82 s e 176–364 MB em background. O benchmark e limitações
estão em [`2026-08-24-graphify-roi.md`](../audits/2026-08-24-graphify-roi.md).

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

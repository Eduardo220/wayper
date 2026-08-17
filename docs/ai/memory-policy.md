# High-Signal Memory — Wayper AI Harness

> **Status:** vigente  
> **Escopo:** memória técnica project-scoped, seletiva e versionada  
> **Owner:** [`harness-v1.md`](harness-v1.md)  
> **Índice ativo:** [`memory/index.json`](memory/index.json)

## Finalidade

Memória não é documentação, source of truth, log de sessão, Git history, TODO ou
segunda arquitetura. Ela preserva somente uma lição técnica cara que uma sessão
futura provavelmente não obteria rápido pelo estado atual.

```text
DERIVABLE -> DO_NOT_SAVE

HARD_EARNED + NON_DERIVABLE + FUTURE_USEFUL + STABLE_ENOUGH
-> MEMORY_CANDIDATE
```

Não existe quota mínima. Zero memórias ativas é saudável quando source, testes e
docs já respondem ao problema.

## Precedência e ownership

| Fonte | Ownership |
| --- | --- |
| `SOURCE` | comportamento implementado atual |
| `TESTS` | comportamento verificado |
| `CANONICAL_DOCS / ADRs` | intenção, decisão e contrato vigente |
| `REPO_MEMORY` | lição auxiliar hard-earned, nunca autoridade |

Memory contradita por source ou decisão canônica é `STALE_MEMORY`. O agente
revalida, atualiza/supersede/retira a memória; nunca adapta código para satisfazer
uma lembrança velha.

Memória técnica Wayper compartilhável pertence ao repositório: é versionada,
revisável, auditável e roteada por domínio/risco. Preferências gerais do usuário
podem pertencer à memória nativa quando houver capacidade suportada, mas
invariantes críticos, arquitetura, negócio, migrations e safety contracts nunca
dependem exclusivamente dela.

Estado de execução — branch, HEAD, diff, warnings atuais, resultado de testes,
candidate ranking ou Goal em andamento — não é memória.

## Auditoria da memória nativa do Codex

Observação local em 2026-08-17, Codex CLI `0.147.0`:

| Capacidade | Resultado confirmado |
| --- | --- |
| `NATIVE_MEMORY_AVAILABLE` | `NO` para uso nesta sessão; não há ferramenta/comando de memória exposto |
| feature | `memories` registrada como `stable`, porém desativada (`false`) |
| state | `codex doctor --json` observa `memories_1.sqlite` íntegro; isso não prova API nem comportamento |
| `NATIVE_MEMORY_SCOPE` | `UNKNOWN` |
| `NATIVE_MEMORY_CONTROLS` | `UNKNOWN` |
| `NATIVE_MEMORY_DISCOVERY` | `UNKNOWN` |
| `NATIVE_MEMORY_WRITE_BEHAVIOR` | `UNKNOWN` |
| `NATIVE_MEMORY_PROJECT_ISOLATION` | `UNKNOWN` |
| `NATIVE_MEMORY_PORTABILITY` | `UNKNOWN` |

A CLI não expõe subcomando `memory`, a configuração ativa não habilita a feature
e a busca em documentação oficial disponível não revelou contrato público para
essas propriedades. O Harness não lê o banco interno, não inventa config e não
depende dessa capacidade. Uma nova versão/feature habilitada invalida somente
esta auditoria; a repo memory continua portátil.

## Inventário preexistente

- não havia store de project memory ativo neste repositório;
- `wayper-brain` está em backup histórico e não é memória nem runtime ativo;
- Graphify mantém graph/cache gerado, reproduzível e não autoritativo;
- audits, changelog, revisões, ADRs e docs do Obsidian preservam documentação e
  história, não entries desta memória;
- o banco interno observado pelo Codex é runtime global e não owner técnico do
  Wayper.

## Promotion pipeline

```text
LEARNING_DELTA
  -> MEMORY_CANDIDATE?
  -> DEDUP
  -> DERIVABLE?
  -> CANONICAL_DOC_INSTEAD?
  -> HARD_EARNED?
  -> STABLE_ENOUGH?
  -> FUTURE_USEFUL?
  -> PROMOTE | DISCARD
```

Promotion ocorre somente depois de `SYNTHESIS + VALIDATION`, ao fim de um slice
importante ou Goal. Learning Delta não é persistido automaticamente e hipótese
de baixa confiança permanece em investigação/follow-up.

### Teste obrigatório

Todos precisam ser verdadeiros:

- `NON_DERIVABLE`: source/docs atuais não respondem rapidamente;
- `FUTURE_USEFUL`: outra sessão possui cenário plausível de uso;
- `STABLE_ENOUGH`: uma alteração trivial não deve invalidar a lição.

E ao menos um:

- `HARD_EARNED`: debugging, tentativa falha ou review profundo foi necessário;
- `FAILURE_PREVENTING`: a lição evita um bug/risco concreto;
- `EXPENSIVE_TO_REDISCOVER`: redescobrir exige exploração substancial.

Confidence persistida é `HIGH` ou `MEDIUM`. Speculation `LOW` não entra.

### Rejeição

Não salvar line/warning counts, paths/imports/owners fáceis de obter, comandos,
dependency versions, Git/PR/local state, outputs de teste, TODOs, diffs, resumo
de sessão, listas de arquivos, decisões já canônicas, fatos obtidos por grep ou
hipóteses não confirmadas. Nova regra de produto ou política do usuário vai
primeiro para a fonte canônica/humana correta.

Antes de promover, buscar em source, docs e topics existentes. Mesma causa e
lição atualiza/mescla a entry; não cria versões paralelas.

## Tipos

- `PITFALL`: armadilha não óbvia;
- `FAILED_APPROACH`: tentativa cara que outra sessão provavelmente repetiria;
- `ARCHITECTURE_LESSON`: comportamento arquitetural difícil de inferir;
- `VALIDATION_LESSON`: prova aparentemente suficiente que não cobria o risco;
- `EXTERNAL_REFERENCE`: fato externo necessário, estável e verificável.

`FAILED_APPROACH` acrescenta `ATTEMPT`, `WHY_IT_FAILED` e
`WHEN_IT_MIGHT_BECOME_VALID`. Preferência de nome/estilo não qualifica.

## Duas camadas

### Tier 1 — active index

[`memory/index.json`](memory/index.json) guarda somente entries `ACTIVE` e apenas:

```text
ID | SUMMARY | TYPE | DOMAINS | RISK_FLAGS | STATUS | PATH
```

O arquivo é o único índice. `SUPERSEDED`/`RETIRED` e archive não aparecem nele.
O index não contém `LESSON` nem duplica topic bodies.

### Tier 2 — topic memory

Cada entry aponta para um Markdown curto sob `docs/ai/memory/topics/`, criado
somente quando uma promotion real ocorrer:

```text
ID | SUMMARY | TYPE | DOMAINS | RISK_FLAGS | STATUS | CONFIDENCE
LESSON | WHY_NON_OBVIOUS | DO | DONT | EVIDENCE
INVALIDATION_CONDITION
```

Evidence aponta para commit, ADR, source owner, teste, issue ou diagnóstico; não
é copiada como narrativa. Paths versionados são relativos ao repo. Secret,
token, password, private key, auth header, PII e diagnóstico bruto sensível são
proibidos.

## Routing e load

Default é `0` bytes. O router considera lookup apenas para `BUG`,
`INVESTIGATION`, `ARCHITECTURAL`, `CRITICAL_RUNTIME` ou Meta slice quando domínio
e risk flags indicarem utilidade.

1. abrir o índice pequeno;
2. intersectar `DOMAINS` e `RISK_FLAGS` da task;
3. refinar se houver muitos matches;
4. abrir no máximo os `1-3` topics mais relevantes;
5. verificar `INVALIDATION_CONDITION` e confirmar source atual antes de decidir.

Dez matches nunca autorizam carregar dez topics. `TRIVIAL`, copy, styling, doc
pequena e `BOUNDED` não relacionado carregam zero. “Pós-corrida” visual não
ativa lifecycle; Firestore social não ativa run memory sem vínculo causal.

Domínios e flags reutilizam exatamente
[`task-classification.md`](task-classification.md); não há taxonomia paralela.

## Budget e economia de contexto

Budget inicial, deliberadamente menor que o teto exploratório:

- máximo de `16` active entries;
- active index máximo de `4.096` bytes;
- `1-3` topics por task;
- topic target até `3.072` bytes; acima de `4.096` exige reduzir/retirar;
- budget nunca aumenta automaticamente.

Quando o índice encostar no limite: dedupe, retirar o que virou derivável,
promover decisões para docs, revalidar stale e arquivar histórico de baixo valor.

Baseline desta unidade: `0` entries, `42` bytes de index e `0` topic bytes.

| Simulação | Index carregado | Topics carregados | Total memory |
| --- | ---: | ---: | ---: |
| `TRIVIAL` | 0 B | 0 B | 0 B |
| `BOUNDED` não relacionado | 0 B | 0 B | 0 B |
| `BUG` de domínio/risco relevante | 42 B | 0 B | 42 B |
| `CRITICAL_RUNTIME` relevante | 42 B | 0 B | 42 B |

Sem topic real, o lookup retorna zero matches; nenhuma seed artificial foi
criada para melhorar o benchmark.

## Staleness, conflito e archive

Status de topic: `ACTIVE`, `SUPERSEDED`, `RETIRED`.

Antes de uso material, confirmar se a `INVALIDATION_CONDITION` ocorreu. Em risco
`CRITICAL/HIGH`, source atual sempre é reconfirmado. Contradições são resolvidas
por source/docs/evidence, nunca por recência: `KEEP_CURRENT`, `SUPERSEDE_OLD`,
`MERGE` ou `RETIRE_BOTH`.

Topic histórico ainda útil pode ir para `docs/ai/memory/archive/`, criado só
quando necessário. Archive não entra no índice nem em query default; Git history
é o fallback quando não há valor em manter arquivo ativo.

Estados de saúde para revisão: `MEMORY_HEALTHY`, `MEMORY_STALE`,
`MEMORY_OVER_BUDGET`, `MEMORY_INVALID`.

## Tooling

Não há query/validator custom nesta baseline. Com `42` bytes e zero entries,
abrir/filtrar o JSON é menor e mais confiável que manter parser, comando e testes.
Ao alterar o index, JSON pode ser validado com Node stdlib e links/fields são
revisados junto aos evals. Tooling só entra quando volume ou erro real tornar
essa verificação manual insuficiente; não entram embeddings, vector DB,
dependency, search engine nem hook nesta unidade.

## Auditoria inicial de candidatos

| Candidate | Evidência atual | Resultado |
| --- | --- | --- |
| owner de recovery/runtime | source, arquitetura, ADR-007/008/027/028 | `DERIVABLE` |
| warning, suite, branch e HEAD atuais | gates/Git | `TEMPORARY` |
| lazy import falhou fisicamente na finalização | ADR-026, bugs, testes e checklist | `CANONICAL_DOC_ALREADY` |
| feedback legado + aliases repetidos causaram `SQLITE_FULL` | ADR-027, arquitetura, testes e bugs | `CANONICAL_DOC_ALREADY` |
| retorno não nulo preservado não confirma pause/resume | ADR-028 e testes | `CANONICAL_DOC_ALREADY` |
| arrays hot são views efêmeras read-only | comentário do owner + teste de cache | `DERIVABLE` |
| Brain antigo e Graphify caches | backup/auditoria da foundation | `REJECT`: histórico/generated, não lesson |
| arquivo de estado `memories_1.sqlite` | Codex doctor local | `TEMPORARY / RUNTIME`, não technical memory |

Resultado: `0 PROMOTED`, `3 CANONICAL_DOC_ALREADY`, `2 DERIVABLE`,
`2 TEMPORARY` e `1 REJECT`. Nenhum candidato passou simultaneamente
non-derivable, stable e future-useful sem duplicar a fonte correta.

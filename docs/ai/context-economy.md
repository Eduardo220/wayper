# Graph-aware Context Economy

> **Status:** vigente<br>
> **Escopo:** descoberta project-owned, Graphify, cache e invalidação de contexto<br>
> **Owners integrados:** [Working Context](working-context.md), [Evidence Receipts](evidence-receipts.md), [Feedback Loop](feedback-loop.md)<br>
> **Runtime:** `scripts/wayper-context-economy.mjs`, `scripts/wayper-graph.mjs`

## Contrato

O resolver implementa `REUSE_BEFORE_READ`, `DIFF_BEFORE_FILE`,
`QUERY_ONCE_PER_VALID_CORPUS`, `INVALIDATE_WHEN_DEPENDENCY_CHANGES` e
`STOP_CONTEXT_EXPANSION_WHEN_SUFFICIENT` somente para aquisição project-owned.
Leituras arbitrárias do host não são interceptadas.

```text
Context Request
  -> Goal Context Index
     -> current ref: revalidate + reuse
     -> shared artifact: revalidate + attach
     -> miss: acquire source or query repo-scoped graph
        -> immutable Context Artifact
           -> bounded ref in Context Map
              -> bounded Context Packet / Feedback diagnosis
```

Autoridade permanece:

```text
runtime/test evidence > current source > config/schema > fresh Graphify
> approved architecture docs > context cache > memory/history
```

Context Artifact orienta descoberta e raciocínio. Ele não é Evidence Receipt,
não satisfaz requirement material e não ganha autoridade por reuse. Uma execução
real de query pode produzir o `GRAPH` receipt existente com observation
`GRAPH_QUERY_EXECUTION`; esse receipt prova somente aquela execução contra o
graph/corpus registrados. Claim sobre source ou comportamento ainda exige o
observer apropriado.

## Freshness do Graphify

Cada repository mantém `graphify-out/` próprio. `wayper` e `wayper-site` nunca
compartilham graph ou corpus; composição cross-repo é explícita no consumidor.
O corpus é o conjunto normalizado de arquivos retornado pelo detector da versão
instalada, o SHA-256 de cada conteúdo e o fingerprint do scope/config/detector.
HEAD e branch ficam em metadata observável, fora do corpus fingerprint.

| Estado | Determinação | Consumo/ação |
| --- | --- | --- |
| `FRESH` | corpus, manifest, graph e metadata atuais | reuse |
| `METADATA_DRIFT` | corpus idêntico; HEAD ou branch divergiu | metadata repair; sem rebuild |
| `STALE_CONTENT` | arquivos adicionados, removidos ou alterados no mesmo scope | incremental somente se capability instalada foi verificada; senão rebuild scoped |
| `STALE_SCOPE` | scope/config mudou ou corpus legado não é verificável | rebuild scoped seguro |
| `UNAVAILABLE` | ferramenta ou graph ausente | fallback para source quando Graphify não é requirement |
| `INVALID` | binding, manifest, hash, path ou estrutura inválida | rejeitar e reacquire/rebuild seguro |

`inspectGraphFreshness()` é read-only. `ensureGraphFresh()` protege repository,
scope, corpus e estado concorrente; site dirty bloqueia escrita. Geração ocorre
em diretório temporário e publica metadata por último. Exit zero não basta:
manifest registrado deve corresponder ao corpus esperado, fingerprints precisam
bater, paths devem permanecer no root e nodes/edges sobreviventes precisam ser
íntegros. Graphify 0.9.38 possui extração incremental verificada no código
instalado; o adapter registra essa capability e nunca a presume para outra versão.
O scope mobile exclui `docs/`, `.codex/`, `eas.json` e baselines JSON: a versão
instalada os classificava como code, mas devolvia zero nodes e os mantinha fora
do manifest. Esses arquivos continuam disponíveis por source/document observer.

`npm run graphify:update -- mobile|site` escolhe reuse, metadata repair,
incremental refresh ou scoped rebuild a partir do estado. Um commit que não muda
o corpus gera apenas `METADATA_DRIFT`.

## Query broker e cache

`queryGraph()` recebe repository, scope, query estruturada, parameters e
Goal identity. A identidade imutável do resultado inclui repository, scope,
corpus/graph fingerprints, query canônica e parâmetros normalizados. Timestamp
não participa. Apenas `query`, `path`, `affected` e `explain` são aceitos;
similaridade semântica de texto livre não é inferida.

Artifacts vivem sob `.wayper-context/cache/artifacts/`, ignorado pelo Git. A
publicação é atômica, não sobrescreve entrada válida e verifica ID, conteúdo,
dependencies e fingerprint na leitura. Entrada alterada, wrong repo/corpus/scope,
symlink ou escape é `INVALID` e descartável. Output limita texto a 4 KiB no
artifact e aplica caps próprios a nodes, edges, paths e references, sempre com
metadata de truncation. Raw graph não é armazenado.

O cache é compartilhável entre Goals quando repository, scope, corpus, query e
dependencies são idênticos. Cada Goal/revision recebe binding novo com sua
baseline e fingerprint de revalidação. O artifact não herda Goal, completion ou
evidence authority. Revisão nova remove o índice ativo; artifacts shared podem
ser explicitamente revalidados e anexados. Baseline nova não altera a data de
criação do artifact.

## Context Artifact e invalidação

Schema v1 fecha quatro kinds: `SOURCE_SLICE`, `DOCUMENT_SLICE`, `GRAPH_QUERY` e
`DERIVED_SUMMARY`. Cada entrada contém repository reference, request, source,
parent ou graph dependencies, conteúdo bounded, fingerprints, criação e
producer. Summary depende dos fingerprints dos parents; qualquer parent stale
invalida o derivado. Nenhum chain-of-thought é persistido.

Source slice usa fingerprint do arquivo ou range determinístico. Mudança fora
de um range comprovadamente idêntico preserva o artifact; quando isso não pode
ser provado, ele é invalidado. O refresh marca somente refs dependentes como
`STALE` e registra causa bounded. Packet recusa ref stale e carrega no máximo 16
artifact IDs, source refs e receipts correspondentes do Goal atual; não carrega
blobs, cache journal ou artifacts irrelevantes. Handoff pode citar esses IDs em
findings, sem promovê-los a evidence.

## Feedback, budgets e observabilidade

Feedback seleciona artifacts current do failure ativo e lineage `SAME_ROOT`.
`INDEPENDENT` e `UNKNOWN` não herdam scope por suposição. Cache miss real dentro
do executor incrementa reacquisition; chamada de diagnosis registra reuse uma
vez. Mudança de source invalida apenas dependencies atingidas antes da attempt
seguinte.

O índice `context` dentro do Context Map mantém refs, invalidations, graph
freshness, expansion state e contadores por Goal/revision. Não duplica conteúdo.
O resolver limita 64 refs no índice, 16 dependencies por artifact, 4 KiB por
artifact e 16 refs por Packet, além do ceiling já pertencente à task. Sob pressão,
reuse precede source targeted, que precede Graphify targeted. `STOP_WHEN_PROVEN`
permite reuse current, mas bloqueia aquisição/expansão nova; não conclui o Goal.

Métricas observadas incluem requests, hits/misses, acquired/reused/invalidated,
duplicates avoided, graph requests/hits/misses/refreshes/stale detections,
Packet refs/bytes e Feedback reuse/reacquisition. `tokenUsage`, `bytesRead` e
`unobservedHostReads` ficam `UNKNOWN` porque o runtime não os observa. O proxy
histórico de bytes da task não é token accounting.

## Limites de fase

Esta infraestrutura não implementa Dispatch/Ownership, leases/CAS, shell/spawn
interception, writer authority, Memory/Brain ou promoção automática de cache.
O cache é efêmero e reconstruível. Fase 7 pode consumir resolver, current refs,
Packet e receipts; Fase 8 deverá definir lifecycle e curadoria próprios para
memória durável.

Gates:

```sh
npm run quality:graph
npm run quality:context-economy
npm run quality:context
```

Mudanças no registry/scope do graph, freshness, broker, artifact schema,
invalidation, Packet ou Feedback selecionam os testes correspondentes no
completion backstop. Nenhum gate reconstrói Graphify automaticamente.

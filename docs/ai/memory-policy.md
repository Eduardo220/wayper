# Durable Project Memory V1

> **Status:** implementado na Fase 8B do Harness V2
> **Owner:** `scripts/wayper-project-memory.mjs`
> **Store canônico:** [`memory/index.json`](memory/index.json)
> **Quality:** `npm run quality:memory`

## Autoridade

Durable Memory é conhecimento promovido, versionado e reutilizável entre Goals.
Não é cache, Working Context, Evidence Receipt, autorização, Completion, log ou
segunda documentação autoritativa.

```text
runtime/test evidence > current source > current config/schema > fresh Graphify
> current project docs > validated durable memory > stale/historical memory
```

Memory recuperada sempre usa `kind: MEMORY` e `authority: CONTEXT_ONLY`.
`assertMemoryAuthority` falha para `EVIDENCE`, `AUTHORIZATION` e `COMPLETION`.
Source atual contraditório vence e marca a entry `CONFLICTED`; dependency alterada
marca `STALE/NEEDS_REVALIDATION`.

## Candidate antes de entry

`LearningCandidate` schema 1 contém identidade do Goal, subject, kind proposto,
statement, scope, supporting/contradicting refs, dependencies, durability reason,
promotion status e fingerprint. Candidate não é memory.

Kinds iniciais:

- `ARCHITECTURAL_INVARIANT`
- `OPERATIONAL_RULE`
- `KNOWN_CONSTRAINT`
- `VALIDATED_PATTERN`
- `KNOWN_FAILURE_MODE`
- `DECISION`

O pipeline fechado é:

```text
validated outcome/finding/feedback/decision
  -> LearningCandidate
  -> deterministic promotion policy
  -> MemoryEntry CURRENT | CANDIDATE_ONLY | HUMAN_DECISION_REQUIRED | REJECTED
```

Auto-promotion exige source atual com dependency fingerprint, documentação ou
decisão humana, validation/Evidence/Completion support, scope conhecido, razão
durável, zero contradiction e zero sensitive material. `DECISION` sem ref
`HUMAN_DECISION` não é inventada. Assertion apenas do modelo permanece
`CANDIDATE_ONLY`; promotion reabre SOURCE/DOCUMENT/dependencies e recusa hashes
que não correspondem ao repository atual. Confidence deriva da provenance: `VERIFIED`, `SUPPORTED` ou
`TENTATIVE`; não há score pseudo-científico.

Leases, grants, permits, Context Artifacts/Packets, cache, raw output,
transcripts, branch/HEAD temporários e WIP externo são rejeitados. Passwords,
tokens, API keys, private keys, authorization e connection strings também são
rejeitados antes da persistência; a redaction da Evidence é defesa adicional,
não licença para armazenar segredo.

## Entry e lifecycle

`MemoryEntry` schema 1 contém `memoryId`, subject, kind, scope, statement,
provenance separada por tipo de ref, confidence, validity, status, dependencies,
timestamps, supersession lineage e fingerprint. Statements têm até 600 bytes,
até 24 support refs, 16 dependencies e retrieval máximo de 10 resultados.

Status: `CURRENT`, `STALE`, `SUPERSEDED`, `INVALIDATED`, `CONFLICTED`.
Supersession adiciona uma entry nova, marca a antiga e preserva ambas. Duas
entries `CURRENT` com mesmo subject/scope e statements diferentes tornam-se
`CONFLICTED`; nenhuma vence por recência. Duplicata exata reutiliza `memoryId`.
Compaction limita-se a dedupe exato, index validation e lineage; não há rewrite
por LLM nem remoção automática de histórico.

Legado schema 1 permanece legível como `LEGACY_UNVERIFIED` até promoção pela
policy atual. Não existe bulk migration automática.

## Store e projeção humana

`docs/ai/memory/index.json` schema 2 é a única truth machine-readable e contém
entries completas. Markdown em `docs/ai/memory/topics/MM-*.md` é projeção one-way
gerada por `writeMemoryStore`; mostra subject, statement, scope, status,
confidence, support, dependencies, lineage e last validation. Obsidian pode
navegar esse Markdown, mas edição manual não altera o JSON. Reconciliação
bidirecional não foi implementada.

Cache de Context/Graphify continua ignorado e reconstruível. Memory promovida é
deliberadamente revisada no Git. Delete físico fica reservado a corrupção,
secret leakage, fixture inválida ou policy explícita.

## Retrieval e integração

`retrieveProjectMemory` aceita repository, capabilities, domains, paths, query,
limit e opt-in histórico. Ranking prioriza scope, status `CURRENT`, confidence,
capability/domain/path; recência não domina provenance. Retorno bounded pode
semear `resolveContext`, Feedback ou discovery de Dispatch, mas não autoriza
actor, não inventa failure e precisa de source/Evidence current quando a claim é
material. `STOP_WHEN_PROVEN` encerra lookup quando o contexto já basta.

## Observabilidade e limites

`memoryTelemetry` agrega candidates generated/promoted/rejected/human-decision,
entries current/stale/superseded/conflicted, retrievals/hits/revalidations/
invalidations e duplicates avoided. Não usa o termo intelligence nem cria
dashboard; a Fase 9 poderá consumir esses dados.

| Capacidade | Estado |
| --- | --- |
| Candidate, policy, provenance, dependency validation | ENFORCED/PROVEN |
| Retrieval bounded, supersession, conflicts, security | ENFORCED/PROVEN |
| Markdown/Obsidian projection one-way | IMPLEMENTED/PROVEN |
| Auto-promotion conservadora | ENFORCED para provenance forte |
| Product decision automática | NEGADA; HUMAN_DECISION_REQUIRED |
| Memory como Evidence/authorization/Completion | NEGADA/PROVEN |
| Vector DB, Brain, daemon, scheduler, mass compaction | NOT_IMPLEMENTED |

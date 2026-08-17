---
name: wayper-persistence-sync
description: Use for Wayper durable storage/repositories, run finalization/recovery, migration, deferred/sync queues, replay, Firestore sync, or consistency; not live GPS or UI-only work.
---

# Wayper persistence and sync

Change durable state and local/remote ordering without introducing a second
canonical store or making Firestore part of the critical path.

## Preconditions

- Identify the persisted contract, current owner and whether the task changes a
  reader, writer, schema, queue or remote boundary.
- Confirm offline behavior and compatibility expectations before editing.
- Separate live GPS ingestion from finish/recovery handoff and durable work.

## Minimum context and references

- Read the affected owner in `src/services/run/runFinalizationService.js`,
  `src/services/run/runDeferredTaskQueueService.js`,
  `src/services/run/runSyncQueueService.js`,
  `src/services/runOfflineStorageService.js`, `src/services/storage/` and the
  related repositories.
- Read matching tests in `src/services/run/__tests__/`,
  `src/services/storage/__tests__/` and `src/repositories/__tests__/`.
- Load only the affected contract in `docs/04-arquitetura.md`,
  `docs/05-modelo-de-dados.md` and ADR-012/026/028 in
  `docs/08-decisoes-tecnicas.md`.

## Workflow

1. Identify the single owner and canonical store.
2. Record the current schema/identity contract.
3. Find every reader and compatibility fallback.
4. Find every writer and their ordering.
5. Define migration/backward compatibility before changing persisted shape.
6. Model local, remote and partial-failure modes.
7. Prove retry/replay idempotency and single-flight ownership.
8. Prove offline behavior without Firestore.
9. Add or adjust targeted regression tests.
10. Select reviewers only for confirmed flags and validate broader ordering.

## Invariants

- Minimum local run save precedes derived work and cleanup.
- Remote sync, territory, XP, ranking and sharing remain deferred/best effort.
- Firestore is not required to start, track, finish, save or recover a run.
- Keep one canonical record per concern; preserve stable run/task identities.
- Make migrations explicit, compatible and retry-safe; never silently reinterpret
  an old shape.

## Validation

Validate readers/writers, save-before-effects ordering, offline recovery,
duplicate delivery, retry/replay, remote failure and migration compatibility.
Use only commands that exist in `package.json`; there is no canonical lint or
typecheck command in this baseline.

## Escalation and specialists

Use `wayper_persistence_reviewer` for durability, migration, queue or Firestore
consistency; add `wayper_concurrency_reviewer` for ordering/single-flight and
`wayper_mobile_lifecycle_reviewer` only for recovery/finish handoff. Escalate on
new persistent state, schema migration, new writer/owner, security boundary or
run-loss risk; the latter also activates `CRITICAL_RUNTIME` and
`wayper-active-run`.

## Output contract

Internally retain `OWNER_SCHEMA`, `READERS_WRITERS`, `MIGRATION`, `FAILURE_MODES`,
`IDEMPOTENCY`, `OFFLINE_PROOF`, `CHANGE` and `VALIDATION`.

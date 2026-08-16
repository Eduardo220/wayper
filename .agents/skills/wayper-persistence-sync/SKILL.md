---
name: wayper-persistence-sync
description: Use for Wayper finished-run save, finalization, recovery handoff, deferred queue, retry/replay, idempotency, or sync; not live GPS.
---

# Wayper persistence and sync

Use only for durable ordering after or around finalization.

## Read on demand

- Contracts: `docs/04-arquitetura.md`, `docs/05-modelo-de-dados.md`, ADR-012,
  ADR-026 and ADR-028 in `docs/08-decisoes-tecnicas.md`.
- Owners: `src/services/run/runFinalizationService.js`,
  `runDeferredTaskQueueService.js`, `runSyncQueueService.js`, related repositories,
  and `src/services/runOfflineStorageService.js`.
- Tests: related files in `src/services/run/__tests__/` and
  `src/repositories/__tests__/`.

## Checks

Prove minimum local save before derived work, stable run/task identities,
single-flight ownership, idempotent retry/replay, and local recovery without
Firestore. Derived territory, XP, ranking and remote sync must remain deferred.

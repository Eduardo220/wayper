---
name: wayper-active-run
description: Use for Wayper active-run GPS lifecycle, background, pause/resume, notification, recovery, or finish handoff; not derived post-run work.
---

# Wayper active run

Use only for the live run lifecycle. Preserve the invariants in `AGENTS.md` and
read the runtime sources directly; this skill is a route, not a second design.

## Read on demand

- Architecture and contracts: `docs/04-arquitetura.md`,
  `docs/wayper/09-arquitetura-tecnica.md`, ADR-027/028 in
  `docs/08-decisoes-tecnicas.md`.
- Physical limits: `docs/22-teste-real-corrida-background.md` and
  `docs/wayper/15-checklist-validacao-corrida-ativa.md`.
- Owners: `index.js`, `src/tasks/activeRunLocationTask.js`,
  `src/services/runTracking/`, `src/services/run/runRecoveryService.js`,
  `src/services/run/runNotificationService.js`, and `src/screens/MapScreen.js`.
- Tests: `src/services/runTracking/__tests__/` and the related tests under
  `src/services/run/__tests__/`.

## Checks

Trace START, RUNNING, PAUSE, RESUME, BACKGROUND, recovery and FINISH. Prove a
single canonical snapshot, no duplicate watcher/task, stale-callback rejection,
confirmed transitions, and minimum local save before the finish handoff. The
headless task is registered by `index.js`; UI is never the runtime owner.

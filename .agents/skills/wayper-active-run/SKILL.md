---
name: wayper-active-run
description: Use for Wayper live-run state, GPS lifecycle, background, pause/resume, notification, recovery, or finish handoff; not run-button styling/copy or visual post-run work.
---

# Wayper active run

Protect the live-run lifecycle without creating a second runtime design.

## Preconditions

- Classify the task and set risk flags before editing. Treat any possible run
  loss/corruption, duration/distance drift, lifecycle, recovery or finish risk
  as `CRITICAL_RUNTIME`.
- Confirm the observed behavior or equivalent evidence and the current owner in
  source. A screen, callback or old doc is not ownership evidence.
- Separate live runtime from visual run UI and derived post-run work. Return to
  routing if the task is only copy/style.

## Minimum context and references

- Start with the affected owner and callers: `index.js`,
  `src/tasks/activeRunLocationTask.js`,
  `src/services/runTracking/`, `src/services/run/runRecoveryService.js`,
  `src/services/run/runNotificationService.js`, and `src/screens/MapScreen.js`.
- Read the related tests in `src/services/runTracking/__tests__/` and
  `src/services/run/__tests__/` before changing behavior.
- Load `docs/04-arquitetura.md`, `docs/wayper/09-arquitetura-tecnica.md` and
  ADR-027/028 in `docs/08-decisoes-tecnicas.md` only for the affected contract.
- For background/screen-off/native behavior, also load
  `docs/22-teste-real-corrida-background.md` and
  `docs/wayper/15-checklist-validacao-corrida-ativa.md`.

## Workflow

For `BUG + CRITICAL_RUNTIME`:

1. Confirm the symptom/evidence and expected behavior.
2. Locate the current runtime owner and all affected callers.
3. Map the relevant START, RUNNING, PAUSE, RESUME, BACKGROUND, recovery and
   FINISH transitions.
4. State the invariants that constrain the change.
5. Search for competing watchers, tasks, callbacks, writers and legacy paths.
6. Reproduce the failure or preserve equivalent diagnostic evidence.
7. Identify root cause; do not start from a proposed solution.
8. Add or adjust the smallest regression that proves the cause when feasible.
9. Implement the fix at the shared owner with the smallest compatible delta.
10. Run targeted tests, then the broader critical matrix proportional to risk.
11. Select specialists only from the confirmed flags.
12. Record untested device/lifecycle risk; never claim physical validation that
    did not occur.

For `ARCHITECTURAL + CRITICAL_RUNTIME`, do not edit before mapping dependencies,
ownership, canonical state transitions, migration/compatibility and failure
modes. Compare alternatives and stage reversible changes; never refactor
`MapScreen` or a runtime owner blindly.

## Invariants

- Keep one canonical active snapshot and one owner for ingestion/transitions.
- Do not duplicate watcher, background task, native notification owner or
  recovery path; reject stale callbacks and mismatched run identities.
- Keep Firestore and derived work out of start, tracking, recovery and finish
  safety. Minimum local save precedes cleanup and post-run effects.
- Keep UI mounted state out of runtime ownership and heavy work out of GPS.
- Preserve confirmed pause/resume/finish transitions and monotonic metrics.

## Validation

Validate the exact transitions and failure modes touched, duplicate delivery,
stale callbacks, offline recovery, minimum-save ordering and related regression
tests. Automated tests do not prove GPS, screen-off, process recreation or
notification behavior on a physical Android device.

## Escalation and specialists

- `LIFECYCLE` or `NATIVE_ANDROID`: consider
  `wayper_mobile_lifecycle_reviewer`.
- `CONCURRENCY`: consider `wayper_concurrency_reviewer`.
- `GPS_GEO`: consider `wayper_geospatial_reviewer`.
- `OFFLINE_STORAGE`, `SYNC` or durable ordering: consider
  `wayper_persistence_reviewer` and load `wayper-persistence-sync` if needed.

Escalate when ownership changes, a new persisted state/migration appears, an API
boundary changes or the fix starts creating a parallel architecture.

## Output contract

Internally retain `EVIDENCE`, `OWNER_LIFECYCLE`, `ROOT_CAUSE_OR_DESIGN`,
`REGRESSION`, `CHANGE`, `VALIDATION` and `UNTESTED_RISK`. Expose only what the
user needs.

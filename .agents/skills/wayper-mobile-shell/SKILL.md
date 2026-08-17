---
name: wayper-mobile-shell
description: Use for Wayper bootstrap, providers, auth gate, root navigation, deep links, onboarding, permissions, or structural shell state; not local styling, active-run internals, or post-run work.
---

# Wayper mobile shell

Change application entry and structural shell boundaries without creating a
second navigator, auth gate or state owner.

## Preconditions

- Confirm the task changes bootstrap, structural navigation/state, auth,
  onboarding or permission flow. Return to routing for local styling.
- Identify the current state owner, entry transition and all consumers before
  moving logic.

## Minimum context and references

- Read the affected owner in `index.js`, `App.js`, `src/navigation/`,
  `src/firebaseConfig.js`,
  `src/services/auth/`, `src/services/onboarding/`, and
  `src/services/permissions.js`.
- Load only the affected flow in `docs/06-fluxos-de-usuario.md`,
  `docs/23-onboarding-permissoes-estados-vazios.md` or the domain row in
  `docs/00-fontes-do-projeto.md`.
- Read adjacent tests and navigation/auth consumers; do not infer behavior from
  the screen alone.

## Workflow

1. Inspect current navigation/state ownership and transitions.
2. Find the existing pattern for the same boundary.
3. Map signed-out, loading, signed-in, denial and deep-link branches affected.
4. Make the smallest change in the existing owner.
5. Verify transitions and fallback/error states.
6. Run targeted tests from the current `package.json` commands.

## Invariants

- Keep one root navigation path and one auth/session gate.
- Register native/headless tasks before React mount; do not move active-run
  ownership into providers or screens.
- Keep permission denial, auth loading and offline/error states explicit.
- Do not turn this skill into generic React Native or visual-component guidance.

## Validation

Validate cold start, auth loading, signed-out/signed-in, relevant deep link,
onboarding and permission-denial transitions. Styling-only work needs only its
targeted visual/accessibility check and should not keep this skill loaded.

## Escalation and specialists

Use `wayper_mobile_lifecycle_reviewer` only for AppState, permission/native entry
or lifecycle risk. Add `wayper_persistence_reviewer` only if durable session or
Firestore consistency changes. Escalate on auth/security boundary, public
navigation API, native registration order or new state owner.

## Output contract

Internally retain `OWNER`, `TRANSITIONS`, `EXISTING_PATTERN`, `CHANGE`,
`VALIDATION` and `UNTESTED_BRANCHES`.

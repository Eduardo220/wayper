---
name: wayper-mobile-shell
description: Use for Wayper app entry, providers, auth gate, root navigation, deep links, onboarding, permissions, or shell UI; not active-run internals or post-run processing.
---

# Wayper mobile shell

Use only for application entry and shell boundaries.

## Read on demand

- Owners: `index.js`, `App.js`, `src/navigation/`, `src/firebaseConfig.js`,
  `src/services/auth/`, `src/services/onboarding/`, and
  `src/services/permissions.js`.
- Flows: `docs/06-fluxos-de-usuario.md` and domain rows in
  `docs/00-fontes-do-projeto.md`.
- Tests: adjacent service/repository tests and navigation consumers.

## Checks

Trace cold start, auth loading, signed-out/signed-in routing, deep-link handling,
onboarding and permission denial. Keep native task registration before React
mount and hand active-run lifecycle changes to `wayper-active-run`.

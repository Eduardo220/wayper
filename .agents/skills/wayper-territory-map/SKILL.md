---
name: wayper-territory-map
description: Use for Wayper territory geometry/capture/storage, coordinate handling, MapLibre data adaptation, or territory rendering; not visual map styling, live-run lifecycle, or post-run queues.
---

# Wayper territory and map

Use only for territory geometry and the map boundary.

## Read on demand

- Contracts: `docs/15-corrida-por-zonas.md`,
  `docs/wayper/03-mecanica-territorios.md`, `docs/05-modelo-de-dados.md`, and
  the territory row in `docs/00-fontes-do-projeto.md`.
- Owners: `src/services/territory/`, `src/repositories/territoryRepository.js`,
  `src/components/Map/WayperMapLibre.js`, and territory components.
- Tests: `src/services/territory/__tests__/` and
  `src/repositories/__tests__/territoryRepository.test.js`.

## Checks

Keep geometry normalized at boundaries, verify coordinate order and polygon
validity, preserve local capture if best-effort sync fails, and avoid inferring
active GPS behavior from finished route input.

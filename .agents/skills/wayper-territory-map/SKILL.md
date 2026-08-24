---
name: wayper-territory-map
description: Use for Wayper territory/route geometry, coordinates, Turf, MapLibre data, capture, storage, or territory rendering; not visual map styling, live-run lifecycle, or post-run queues.
---

# Wayper territory and map

Change geospatial data and territory behavior without confusing geometry,
storage and visual styling boundaries.

## Preconditions

- Confirm the task changes coordinates, route/territory geometry, units,
  capture/storage semantics or MapLibre data. Return to UI routing for color,
  spacing or copy only.
- Identify source coordinate order, units and the owner of normalization before
  applying a geometry operation.

## Minimum context and references

- Read the affected owner in `src/services/territory/`,
  `src/services/tracking/`, `src/repositories/territoryRepository.js` or
  `src/components/Map/WayperMapLibre.js`.
- Read matching tests in `src/services/territory/__tests__/`,
  `src/services/tracking/__tests__/` and
  `src/repositories/__tests__/territoryRepository.test.js`.
- Load only the relevant contract in `docs/15-corrida-por-zonas.md`,
  `docs/wayper/03-mecanica-territorios.md`,
  `docs/wayper/05-gps-e-validacao.md` or `docs/05-modelo-de-dados.md`.

## Workflow

1. Identify source data, canonical shape and provenance.
2. State longitude/latitude order, projection and units.
3. Trace normalization before the geometry operation.
4. Verify the chosen Turf/native operation and output shape.
5. Cover empty, short, duplicate, invalid and boundary-crossing inputs.
6. Check the Turf-to-storage and Turf-to-MapLibre boundaries separately.
7. Preserve current repository/storage ownership and compatibility.
8. Add targeted regression tests, then request geospatial review when risk
   justifies it.

## Invariants

- Never swap latitude/longitude or compare mixed units/projections.
- Keep normalized, valid geometry at repository/rendering boundaries.
- Do not infer territory eligibility for a free run from geometry alone.
- Preserve local capture when best-effort remote sync fails.
- Do not reintroduce legacy territory storage or make rendering the data owner.
- Do not infer live GPS lifecycle behavior from a finished route.

## Validation

Validate coordinate order, units, normalization, polygon/route validity, edge
cases, repository round-trip and MapLibre data shape. Visual styling requires a
visual/accessibility check, not this full workflow.

## Escalation and specialists

Use `wayper_geospatial_reviewer` for `GPS_GEO`, geometry, filters or distance.
Add persistence review for storage/migration, concurrency/lifecycle only for
live GPS, and `wayper-active-run` when the active lifecycle is affected.
Escalate on shared normalization/schema, migration, new storage owner, product
eligibility rule or live-run metric risk.

## Output contract

Internally retain `SOURCE_SHAPE`, `COORDINATES_UNITS`, `OPERATION`, `EDGE_CASES`,
`BOUNDARIES`, `CHANGE` and `VALIDATION`.

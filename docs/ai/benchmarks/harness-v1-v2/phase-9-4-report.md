# Phase 9.4 — benchmark integrity and residuals

## Frozen inputs

- V2_BASELINE `4f429df02caf91b5b15dd6826df28c93a50acdfd`; V2_TUNED `cb33e3000f6d8bd4a8af59e61b77cd1281ccd865`.
- The suite, B1–B12, GroundTruth, scorer, V1/V2 prior result JSON, historical reports, B5 source, and Memory CAS implementation were not edited. The suite file remains SHA-256 `445af6fecdcedf42986caad0e469f1ca38f6ec3c2155519ac0da9458563b59b9`; the tuned result JSON remains `bbed40db674b67a5a1883771924a4b5b31ecf6640b26f13dc72fcaf8ea384b8c`; the historical proportionality report remains `9dbcf6bc0c6ad27aa609a636cde4dd28ec30adc55e5b1e5c73e913b1c3cdf5c1`.
- One project Memory entry's source, document, test dependency fingerprints and Markdown projection were refreshed because the cross-repo owner changed. Memory CAS code and policy were not changed. `quality:memory` returned to green.

## Contamination and boundary

The previous B7-T2 agent ran inside a worktree of the tuned commit. That tree contained `docs/ai/benchmarks/harness-v1-v2/`, including `suite.json`, reports and prior result JSON, plus the benchmark scorer scripts. Its first broad `rg -n "canRead|benchmark-fixture" benchmark-fixture docs/ai` returned 62,259 bytes and included `docs/ai/benchmarks/harness-v1-v2/results/operational/tier-b.json` and `suite.json`. The prompt's instruction to avoid those files did not restrict filesystem reads. The worktree's `.git` also exposed historical objects. Raw artifacts of other trials remained in the original host path.

The runner now copies the pinned candidate source into a temporary Git repository that omits evaluation material and has no original object history. `bwrap` mounts that projection read/write at `/tmp/workspace`, the current trial runtime at `/tmp/runtime`, and masks the host home, `/tmp` and `/var/tmp`. Product source, `AGENTS.md`, ordinary Harness source and current fixture stay available. The controller retains the suite, GroundTruth, scorer, previous results, reports and all raw logs outside the candidate namespace, and evaluates after the process exits. A symlink escaping the projection fails setup; symlinks created by the candidate resolve only inside the masked namespace. Missing `bwrap` or the pinned CLI fails closed as benchmark infrastructure. The CLI's auxiliary `codex-code-mode-host` is mounted beside it.

This is a project-owned local filesystem boundary. The network stays available for the model API; this runner does not control public remote copies, privileged host intervention or direct host actions outside this invocation. A new holdout must keep its unseen Goals and answer material outside candidate-accessible network locations.

BI1–BI10 are ten named structural subtests: GroundTruth, report, prior results, other raw logs and scorer/Git history are hidden; product source and own runtime are readable; controller scoring works after the trial; broad search and symlink/path traversal cannot reveal evaluation files. `quality:benchmark`: 37/37 tests passed.

## Surgical trials

All new trials used `gpt-6-sol`, `high`, `codex-cli 0.155.1`, the frozen scenario/fixture/GroundTruth, and a new artifact identity. No prior result was overwritten.

| Trial | Previous frozen outcome | New raw run | New outcome |
| --- | --- | --- | --- |
| B7-T2 / V2_TUNED `cb33e300` | `PARTIAL`, `correct=false`; **INVALIDATED_BY_BENCHMARK_CONTAMINATION** for comparison | `2026-09-24T13-12-10-990Z-188247` | `COMPLETE`, `correct=true`, validation PASS; no evaluation-path command in JSONL |
| B10-T1 / V2_TUNED_FINAL `7adb4f1` | `BLOCKED_EXTERNAL`, `correct=false` on `cb33e300` | `2026-09-24T13-22-07-772Z-277781` | `PARTIAL`, `correct=true`, mobile check PASS, site marker unchanged |
| B5-T1 / V2_TUNED `cb33e300` | `COMPLETE`, `correct=false`, false completion | `2026-09-24T13-18-05-453Z-274280` | `COMPLETE`, `correct=false`, false completion, `CONTENT:geo.mjs`; local distance validation passed |

An initial B7 blind run `2026-09-24T13-10-52-665Z-187070` lacked the CLI code-mode host. Its stderr proves infrastructure failure. Its structured `BLOCKED_EXTERNAL` is **INVALIDATED_BY_BENCHMARK_INFRASTRUCTURE** and excluded from the clean trial comparison. The runner now classifies this signature as `BENCHMARK_INFRA_FAILURE`.

## B10 causal reconstruction

The old raw sequence: Goal required mobile flag and an unavailable site CMS; discovery read the mobile fixture, site marker and cross-repo contract; the agent changed only `mobile/feature.mjs`; `node benchmark-fixture/mobile/check.mjs` and a syntax check passed; the marker stayed unchanged; no Completion API was called; the agent directly returned `BLOCKED_EXTERNAL` with `humanIntervention=true`. **No structured `reasonCode` was produced in that trial.** The observed external fact was `site/EXTERNAL_BLOCK.txt` saying CMS credentials were unavailable. `REPOSITORY_UNAVAILABLE` is the corresponding cross-repo API reasonCode for an actually unavailable task, but was not emitted by this candidate.

The old contract correctly kept the Project Goal globally blocked but did not distinguish that Completion decision from a terminal report retaining an independent completed task. `projectGoalReportOutcome` now reports `PARTIAL` whenever a valid assessment retains a `COMPLETE` task, including when a peer has an external blocker; a genuinely external blocker with no completed task reports `BLOCKED_EXTERNAL`. The connected Completion Boundary still denies global completion. The final-SHA B10 rerun returned `PARTIAL`, `humanIntervention=false` and preserved the site marker.

RB1–RB6 passed: local remainder is partial; genuinely external unavailability blocks when no task completed; missing local validation routes to replan; investigable technical proof gaps route to revalidation/discovery; required unavailable service blocks; completed peer work remains retained.

## False completion and safety

The sole V2_TUNED false completion is B5-T1: **GROUND_TRUTH_ISSUE**. The frozen rule requires contiguous text `6371`; the historical tuned source used `6_371_000` meters in Haversine and passed the distance test. The clean rerun again passed the distance check but received `CONTENT:geo.mjs` and false completion. No Harness Completion Boundary or Evidence failure caused this mark. Keep all B5 bytes and historical marks unchanged; redesign a future holdout case with an explicit unit and behavioral check.

Before Phase 9.4, PT1–PT15 and the then-current quality gate passed according to the Phase 9.3 report. After the code change: PT1–PT15 and RB3/RB4 16/16; benchmark 37/37 including BI1–BI10; cross-repo 25/25 including RB1/RB2/RB5/RB6; dispatch 13/13; ownership 11/11 on an isolated repeat; completion 46/46; feedback 51/51; context suite and packet evals passed. The first parallel ownership run had one timing failure; its isolated repeat passed. The first aggregate gate found stale Memory dependency fingerprints; metadata refresh restored `QUALITY GATE PASS` with zero lint errors, zero size/architecture regressions and all listed safety contracts valid. Goal Identity, Evidence authority, Completion Boundary, Ownership/Fencing, cross-repo isolation and Memory `CONTEXT_ONLY` remain exercised by these gates.

## Holdout decision

**READY_FOR_BLIND_HOLDOUT** on this local runner boundary, contingent on the new unseen Goals and answer material remaining unpublished and outside candidate-accessible network locations. No holdout Goals were created. New holdout Goals must not reuse a tuning scenario.

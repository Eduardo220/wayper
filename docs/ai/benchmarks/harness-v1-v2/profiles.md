# Harness benchmark execution profiles

The frozen `suite.json` and existing `results/tier-*.json`/`report.md` are the
**historical / Astra / xhigh** dataset. Do not rewrite them when running the
operational benchmark.

The main `npm run benchmark:tier-b` command now selects **operational / Sol /
high**. It derives the same B1–B12 scenarios, GroundTruth, scoring and failure
taxonomy from the frozen suite, changing only the execution identity to
`gpt-6-sol`, `high`, and the installed Codex CLI version. Both candidates use
that one profile. The profile and exact CLI version are included in the suite
and result fingerprints. A CLI upgrade changes the fingerprint and cannot be
silently resumed into an older run.

```sh
npm run quality:benchmark
npm run benchmark:tier-b -- --only=B1,B2
npm run benchmark:tier-b -- --extend-smoke=<run-id>
npm run benchmark:report
```

Operational results go to `results/operational/tier-b.json` and
`operational-report.md`. Each run's checkpoint, per-attempt stdout/stderr,
invocation flags, exit status, diagnostics and trial results remain under
`.wayper-context/benchmark-runs/operational/<run-id>/`. Resume a paused run
with `npm run benchmark:tier-b -- --resume=<run-id>`; a usage limit stops it as
`EXTERNAL_BLOCK` without counting the blocked attempt as a candidate result.
Extension of a successful B1/B2 smoke preserves `smoke-checkpoint.json` and
`smoke-results.json`, reuses those four exact trials and runs only B3–B12.
The local raw directory is ignored by Git and must be archived separately if
the run needs to survive workspace deletion.

`npm run benchmark:tier-b:historical` and `npm run benchmark:report:historical`
remain explicit historical entrypoints, but are not part of the operational
workflow. Do not run Astra/xhigh to compare with Sol/high: these are separate
datasets.

For Phase 9.3, `operational-tuned` derives the same frozen corpus and
Sol/high/CLI runtime, but pins V2 to the committed tuning SHA. It runs V2 only;
the persisted V1 and V2 baseline trials remain separate. Its profile and SHA
change the suite/result fingerprint. The B1/B2 smoke can be extended without
rerunning those trials; usage limits retain the checkpoint as `EXTERNAL_BLOCK`.

```sh
npm run benchmark:tier-b:tuned -- --tuned-sha=<V2_TUNED> --only=B1,B2
npm run benchmark:tier-b:tuned -- --tuned-sha=<V2_TUNED> --extend-smoke=<run-id>
npm run benchmark:tier-b:tuned -- --tuned-sha=<V2_TUNED> --resume=<run-id>
```

Raw logs use `.wayper-context/benchmark-runs/operational-tuned/<run-id>/`;
completed results use `results/operational/tier-b-tuned.json`. Never point a
tuned run at an existing baseline or historical result path.

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

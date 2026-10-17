import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeFlightRecorder } from "./active-run-flight-timeline.mjs";

test("flags GPS, checkpoint, elapsed and headless gaps", () => {
  const input = [
    { event: "APP_BACKGROUND", wallMs: 0 },
    { event: "GPS_RAW", wallMs: 1000, source: "headless", point: { timestamp: 1 } },
    { event: "GPS_ACCEPTED", wallMs: 1001, source: "background", point: { timestamp: 1 } },
    { event: "CHECKPOINT_SUCCESS", wallMs: 2000 },
    { event: "HEADLESS_TASK_END", wallMs: 3000 },
    { event: "TIME_SNAPSHOT", wallMs: 5000, elapsedMs: 5000, runState: "RUNNING" },
    { event: "HEADLESS_TASK_START", wallMs: 50000 },
    { event: "GPS_RAW", wallMs: 51000, source: "headless", point: { timestamp: 2 } },
    { event: "TIME_SNAPSHOT", wallMs: 52000, elapsedMs: 70000, runState: "RUNNING" },
    { event: "CHECKPOINT_SUCCESS", wallMs: 53000 },
    { event: "APP_FOREGROUND", wallMs: 54000 },
  ].map((entry) => JSON.stringify({ localRunId: "run-1", wallTime: new Date(entry.wallMs).toISOString(), ...entry })).join("\n");
  const types = analyzeFlightRecorder(input).findings.map((finding) => finding.type);
  for (const expected of ["GPS_RAW_WITHOUT_ACCEPTED", "GPS_GAP", "CHECKPOINT_GAP", "ELAPSED_JUMP", "BACKGROUND_INTERVAL", "HEADLESS_GAP"]) {
    assert.ok(types.includes(expected), expected);
  }
});

test("CLI summarizes GPS counts without printing every point", () => {
  const dir = mkdtempSync(join(tmpdir(), "flight-timeline-"));
  try {
    const input = join(dir, "run.jsonl");
    writeFileSync(input, [
      { event: "RUN_STARTED", wallMs: 1000 },
      { event: "GPS_RAW", wallMs: 2000, point: { timestamp: 2 } },
      { event: "RUN_FINISHED", wallMs: 3000 },
    ].map((entry) => JSON.stringify({ localRunId: "run-1", wallTime: new Date(entry.wallMs).toISOString(), ...entry })).join("\n"));
    const script = fileURLToPath(new URL("./active-run-flight-timeline.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [script, input], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /GPS_RAW=1/);
    assert.doesNotMatch(result.stdout, /GPS_RAW .*elapsed=/);
    assert.match(result.stdout, /GPS_RAW_WITHOUT_ACCEPTED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

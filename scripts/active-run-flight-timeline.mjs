#!/usr/bin/env node
import { readFileSync } from "node:fs";

export function analyzeFlightRecorder(lines, options = {}) {
  const gpsGapMs = Number(options.gpsGapMs || 30000);
  const checkpointGapMs = Number(options.checkpointGapMs || 30000);
  const events = lines.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error(`Invalid JSON at line ${index + 1}`); }
  });
  const findings = [];
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1];
    const current = events[index];
    if (previous.processId && previous.processId === current.processId &&
      previous.monotonicMs != null && current.monotonicMs != null) {
      const drift = (current.wallMs - previous.wallMs) - (current.monotonicMs - previous.monotonicMs);
      if (Math.abs(drift) > 5000) findings.push({ at: current.wallTime, type: "WALL_CLOCK_JUMP", driftMs: drift });
    }
  }
  const raw = events.filter((entry) => entry.event === "GPS_RAW");
  const acceptedTimes = new Set(events.filter((entry) => entry.event === "GPS_ACCEPTED")
    .map((entry) => entry.point?.timestamp));
  const seenRaw = new Set();
  let unmatched = null;
  const flushUnmatched = () => {
    if (unmatched) findings.push(unmatched);
    unmatched = null;
  };
  for (const entry of raw) {
    const key = entry.point?.timestamp;
    if (entry.point?.timestamp != null && !seenRaw.has(key) && !acceptedTimes.has(key)) {
      unmatched ||= { at: entry.wallTime, type: "GPS_RAW_WITHOUT_ACCEPTED", count: 0, until: entry.wallTime };
      unmatched.count += 1;
      unmatched.until = entry.wallTime;
    } else if (acceptedTimes.has(key)) {
      flushUnmatched();
    }
    seenRaw.add(key);
  }
  flushUnmatched();
  for (let index = 1; index < raw.length; index += 1) {
    const gap = raw[index].wallMs - raw[index - 1].wallMs;
    if (gap > gpsGapMs) findings.push({ at: raw[index].wallTime, type: "GPS_GAP", gapMs: gap });
  }
  const lastWallMs = events.at(-1)?.wallMs;
  if (events.length && !raw.length) findings.push({ at: events.at(-1).wallTime, type: "NO_GPS_RAW" });
  if (raw.length && lastWallMs - raw.at(-1).wallMs > gpsGapMs) {
    findings.push({ at: events.at(-1).wallTime, type: "GPS_GAP", gapMs: lastWallMs - raw.at(-1).wallMs });
  }
  let previousCheckpoint = null;
  const canonicalObserved = events.some((entry) => entry.event.startsWith("CHECKPOINT_") && entry.writer === "canonical");
  let previousElapsed = null;
  let headlessEnd = null;
  let backgroundAt = null;
  for (const entry of events) {
    if (entry.event === "CHECKPOINT_SUCCESS" && (!canonicalObserved || entry.writer === "canonical")) {
      if (previousCheckpoint && entry.wallMs - previousCheckpoint.wallMs > checkpointGapMs) {
        findings.push({ at: entry.wallTime, type: "CHECKPOINT_GAP", gapMs: entry.wallMs - previousCheckpoint.wallMs });
      }
      previousCheckpoint = entry;
    }
    if (entry.event === "TIME_SNAPSHOT" && entry.elapsedMs != null) {
      if (previousElapsed && entry.runState === "RUNNING" && previousElapsed.runState === "RUNNING") {
        const drift = (entry.elapsedMs - previousElapsed.elapsedMs) - (entry.wallMs - previousElapsed.wallMs);
        if (Math.abs(drift) > 5000) findings.push({ at: entry.wallTime, type: "ELAPSED_JUMP", driftMs: drift });
      }
      previousElapsed = entry;
    }
    if (entry.event === "APP_BACKGROUND") backgroundAt = entry.wallMs;
    if (entry.event === "APP_FOREGROUND" && backgroundAt != null) {
      findings.push({ at: entry.wallTime, type: "BACKGROUND_INTERVAL", gapMs: entry.wallMs - backgroundAt });
      backgroundAt = null;
    }
    if (entry.event === "HEADLESS_TASK_END") headlessEnd = entry.wallMs;
    if (entry.event === "HEADLESS_TASK_START" && headlessEnd != null) {
      if (entry.wallMs - headlessEnd > gpsGapMs) findings.push({ at: entry.wallTime, type: "HEADLESS_GAP", gapMs: entry.wallMs - headlessEnd });
      headlessEnd = null;
    }
  }
  if (events.length && !previousCheckpoint) findings.push({ at: events.at(-1).wallTime, type: "NO_CHECKPOINT" });
  if (previousCheckpoint && lastWallMs - previousCheckpoint.wallMs > checkpointGapMs) {
    findings.push({ at: events.at(-1).wallTime, type: "CHECKPOINT_GAP", gapMs: lastWallMs - previousCheckpoint.wallMs });
  }
  if (backgroundAt != null) findings.push({ at: events.at(-1).wallTime, type: "BACKGROUND_OPEN", gapMs: lastWallMs - backgroundAt });
  return { runId: events[0]?.localRunId || null, events, findings };
}

if (process.argv[1]?.endsWith("active-run-flight-timeline.mjs")) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write("Usage: node scripts/active-run-flight-timeline.mjs <exported.jsonl>\n");
    process.exitCode = 2;
  } else {
    const result = analyzeFlightRecorder(readFileSync(path, "utf8"));
    process.stdout.write(`Run ${result.runId || "unknown"}: ${result.events.length} events, ${result.findings.length} findings\n`);
    const counts = Object.create(null);
    for (const entry of result.events) counts[entry.event] = (counts[entry.event] || 0) + 1;
    process.stdout.write(`Counts: ${Object.entries(counts).map(([event, count]) => `${event}=${count}`).join(" ")}\n`);
    for (const entry of result.events.filter((item) => /^(RUN_STARTED|RUN_PAUSED|RUN_RESUMED|RUN_FINISHING|RUN_FINISHED|APP_|GPS_WATCH_|GPS_ERROR|HEADLESS_TASK_(START|END|ERROR)|TRACKING_|CHECKPOINT_FAILED|SESSION_|TIME_SNAPSHOT)/.test(item.event))) {
      process.stdout.write(`${entry.wallTime} ${entry.event} ${entry.source || ""} ${entry.reason || ""} elapsed=${entry.elapsedMs ?? "-"} distance=${entry.distanceMeters ?? "-"}\n`);
    }
    for (const finding of result.findings) process.stdout.write(`GAP ${finding.at} ${finding.type} ${finding.gapMs ?? finding.driftMs ?? finding.count ?? ""}${finding.until ? ` until=${finding.until}` : ""}\n`);
  }
}

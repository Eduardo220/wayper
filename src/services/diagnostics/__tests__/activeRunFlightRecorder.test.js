import { afterEach, expect, test } from "@jest/globals";
import {
  __getFlightEntriesForTests,
  __resetFlightRecorderForTests,
  __setFlightWriteFailureForTests,
  __setFlightFileSystemForTests,
  flushFlightRecorder,
  getLastFlightRecorderFile,
  getRecentFlightRecorderFiles,
  recordFlightEvent,
} from "../activeRunFlightRecorder.js";

afterEach(__resetFlightRecorderForTests);

test("records ordered run events without coordinates or user identity", async () => {
  const snapshot = {
    activeRunId: "run-1",
    localRunId: "run-1",
    status: "RUNNING",
    distanceMeters: 42,
    userId: "private-user",
    currentLocation: { latitude: -23.5, longitude: -46.6, accuracy: 9, timestamp: 123 },
  };
  recordFlightEvent("GPS_RAW", { snapshot, source: "foreground", point: { coords: { latitude: -23.5, longitude: -46.6, accuracy: 9, speed: 2, heading: 90 }, timestamp: 123 } });
  recordFlightEvent("GPS_ACCEPTED", { snapshot, source: "foreground", point: { timestamp: 123, accuracy: 9 } });
  const events = await __getFlightEntriesForTests();
  expect(events.map((event) => event.event)).toEqual(["GPS_RAW", "GPS_ACCEPTED"]);
  expect(events[0]).toMatchObject({ localRunId: "run-1", point: { accuracy: 9, speed: 2, bearing: 90 }, distanceMeters: 42 });
  expect(JSON.stringify(events)).not.toMatch(/latitude|longitude|private-user/);
});

test("writer failure is contained and later events can be flushed", async () => {
  __setFlightWriteFailureForTests(true);
  expect(() => recordFlightEvent("RUN_STARTED", { runId: "run-2" })).not.toThrow();
  expect((await flushFlightRecorder()).lastError).toBe("test_flight_write_failure");
  __setFlightWriteFailureForTests(false);
  recordFlightEvent("RUN_FINISHED", { runId: "run-2" });
  expect((await flushFlightRecorder()).lastError).toBeNull();
  expect((await __getFlightEntriesForTests()).map((entry) => entry.event)).toEqual(["RUN_STARTED", "RUN_FINISHED"]);
});

test("appends to one file per run and retains eight recent files", async () => {
  const files = new Map();
  let modified = 0;
  class Directory {
    constructor(_base, name) { this.name = name; }
    create() {}
    list() { return [...files.keys()].map((name) => new File(this, name)); }
  }
  class File {
    constructor(_directory, name) { this.name = name; this.uri = `file://${name}`; }
    get exists() { return files.has(this.name); }
    get size() { return files.get(this.name)?.bytes.length || 0; }
    get modificationTime() { return files.get(this.name)?.modified || 0; }
    create() { files.set(this.name, { bytes: new Uint8Array(), modified: ++modified }); }
    delete() { files.delete(this.name); }
    open() {
      const file = this;
      return {
        size: file.size,
        offset: 0,
        writeBytes(bytes) {
          const previous = files.get(file.name).bytes;
          const next = new Uint8Array(this.offset + bytes.length);
          next.set(previous);
          next.set(bytes, this.offset);
          files.set(file.name, { bytes: next, modified: ++modified });
        },
        close() {},
      };
    }
  }
  __setFlightFileSystemForTests({ Directory, File, Paths: { document: "file://documents" } });
  const originalTextEncoder = globalThis.TextEncoder;
  globalThis.TextEncoder = undefined;
  try {
    recordFlightEvent("RUN_STARTED", { runId: "run-1", reason: "ação" });
    await flushFlightRecorder();
  } finally {
    globalThis.TextEncoder = originalTextEncoder;
  }
  recordFlightEvent("RUN_FINISHED", { runId: "run-1" });
  await flushFlightRecorder();
  const lines = new TextDecoder().decode(files.get("run-1.jsonl").bytes).trim().split("\n");
  expect(lines.map((line) => JSON.parse(line).event)).toEqual(["RUN_STARTED", "RUN_FINISHED"]);
  expect(JSON.parse(lines[0]).reason).toBe("ação");
  for (let index = 2; index <= 9; index += 1) {
    recordFlightEvent("RUN_STARTED", { runId: `run-${index}` });
    await flushFlightRecorder();
  }
  expect(files.size).toBe(8);
  expect(files.has("run-1.jsonl")).toBe(false);
  expect((await getLastFlightRecorderFile()).name).toBe("run-9.jsonl");
  expect((await getRecentFlightRecorderFiles()).map((file) => file.name)).toHaveLength(8);
});

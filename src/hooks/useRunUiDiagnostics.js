import { useEffect } from "react";
import { splitPathIntoSegments } from "../services/runTracking";
import { isForegroundWatcherActive } from "../services/runTracking/activeRunForegroundWatcher.js";
import { setRuntimeSurfaceState } from "../services/runTracking/activeRunRuntimeService.js";
import { recordRunEvent } from "../services/diagnostics/runDiagnosticsService.js";

const HEARTBEAT_MS = 30000;

export default function useRunUiDiagnostics({
  contextRef,
  displayRouteSegments,
  displayRouteState,
  paused,
  recordSnapshot,
  replaying,
  routeState,
  running,
}) {
  useEffect(() => {
    const refs = contextRef.current;
    const routePath = running || paused ? displayRouteState : routeState;
    const routeSegments = running || paused ? displayRouteSegments : splitPathIntoSegments(routePath);
    const routePointsCount = Array.isArray(routePath) ? routePath.length : 0;
    const routeSegmentsCount = Array.isArray(routeSegments) ? routeSegments.length : 0;
    const displayPointsCount = Array.isArray(displayRouteState) ? displayRouteState.length : 0;
    const key = [
      refs.runId.current || "no-run",
      routePointsCount,
      routeSegmentsCount,
      displayPointsCount,
      running ? "running" : paused ? "paused" : replaying ? "replay" : "idle",
    ].join(":");
    if (key === refs.lastMapRouteDiagnostic.current) return;
    refs.lastMapRouteDiagnostic.current = key;
    if (routePointsCount === 0 && routeSegmentsCount === 0) return;

    const renderedAt = Date.now();
    const renderIntervalMs = refs.lastMapRouteRenderAt.current
      ? renderedAt - refs.lastMapRouteRenderAt.current
      : null;
    refs.lastMapRouteRenderAt.current = renderedAt;
    refs.lastRenderPathUpdated.current = new Date(renderedAt).toISOString();
    setRuntimeSurfaceState({ lastRenderPathUpdatedAt: refs.lastRenderPathUpdated.current });
    recordRunEvent("MAP_ROUTE_RENDERED", {
      runId: refs.runId.current,
      status: refs.status.current,
      routePointsCount,
      routeSegmentsCount,
      displayPointsCount,
      lastValidRoutePointsCount: refs.routeState.current?.length || 0,
      renderIntervalMs,
      routeUiUpdateIntervalMs: 1000,
      pendingRouteUiSnapshot: Boolean(refs.pendingUiSnapshot.current),
      screen: "MapScreen",
    });
    recordSnapshot("render_path_update", {
      routePointsCount,
      routeSegmentsCount,
      displayPointsCount,
      lastRenderPathUpdatedAt: refs.lastRenderPathUpdated.current,
    }, { minIntervalMs: HEARTBEAT_MS });
  }, [
    contextRef,
    displayRouteSegments,
    displayRouteState,
    paused,
    recordSnapshot,
    replaying,
    routeState,
    running,
  ]);

  useEffect(() => {
    if (!running && !paused) return undefined;
    const refs = contextRef.current;
    const emitHeartbeat = () => {
      const now = Date.now();
      const previous = refs.lastUiHeartbeat.current;
      if (previous && now - previous > HEARTBEAT_MS * 2) {
        refs.uiStalls.current += 1;
        recordRunEvent("RUN_UI_STALL", {
          runId: refs.runId.current,
          status: refs.status.current,
          elapsedSinceLastHeartbeatMs: now - previous,
          thresholdMs: HEARTBEAT_MS * 2,
          stallCount: refs.uiStalls.current,
          screen: "MapScreen",
        });
        recordSnapshot("ui_stall", { elapsedSinceLastHeartbeatMs: now - previous }, { force: true });
      }

      const lastRenderAt = refs.lastRenderPathUpdated.current
        ? Date.parse(refs.lastRenderPathUpdated.current)
        : 0;
      const lastAcceptedAt = refs.lastLocationAccepted.current
        ? Date.parse(refs.lastLocationAccepted.current)
        : 0;
      const renderStalled = refs.running.current && refs.status.current === "active" &&
        (refs.renderPath.current?.length || refs.trustedPath.current?.length) &&
        Number.isFinite(lastRenderAt) && lastRenderAt > 0 && now - lastRenderAt > HEARTBEAT_MS * 2 &&
        (!lastAcceptedAt || lastAcceptedAt >= lastRenderAt) &&
        now - refs.lastMapRenderStallAt.current > HEARTBEAT_MS * 2;
      if (renderStalled) {
        refs.lastMapRenderStallAt.current = now;
        recordRunEvent("MAP_RENDER_STALL_DETECTED", {
          runId: refs.runId.current,
          status: refs.status.current,
          elapsedSinceLastRenderMs: now - lastRenderAt,
          lastLocationAcceptedAt: refs.lastLocationAccepted.current,
          lastRenderPathUpdatedAt: refs.lastRenderPathUpdated.current,
          routePointsCount: refs.trustedPath.current?.length || 0,
          displayPointsCount: refs.renderPath.current?.length || 0,
          screen: "MapScreen",
          level: "warn",
        });
        recordSnapshot("map_render_stall", { elapsedSinceLastRenderMs: now - lastRenderAt }, { force: true });
      }

      refs.lastUiHeartbeat.current = now;
      recordRunEvent("RUN_UI_HEARTBEAT", {
        runId: refs.runId.current,
        status: refs.status.current,
        lastUiTickAt: refs.lastUiTick.current,
        lastRenderPathUpdatedAt: refs.lastRenderPathUpdated.current,
        timerStatus: refs.timer.current ? "running" : refs.status.current === "paused" ? "paused" : "stopped",
        watcherStatus: isForegroundWatcherActive() ? "foreground_active" : "stopped",
        appState: refs.appState.current,
        screen: "MapScreen",
      });
      recordSnapshot("ui_heartbeat", {}, { minIntervalMs: HEARTBEAT_MS });
    };

    emitHeartbeat();
    const heartbeat = setInterval(emitHeartbeat, HEARTBEAT_MS);
    return () => clearInterval(heartbeat);
  }, [contextRef, paused, recordSnapshot, running]);
}

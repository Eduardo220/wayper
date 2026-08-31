import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import { splitPathIntoSegments } from "../services/runTracking";
import { isRunOwnedByCurrentUser } from "../utils/runOwnership";
import {
  buildRunReplayTimeline,
  getReplayIndexForElapsed,
  getReplayRunStats,
} from "../utils/runReplay";

const requestFrame = (callback) => typeof globalThis.requestAnimationFrame === "function"
  ? globalThis.requestAnimationFrame(callback)
  : setTimeout(() => callback(Date.now()), 16);

const cancelFrame = (handle) => {
  if (handle == null) return;
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle);
  } else {
    clearTimeout(handle);
  }
};

const isZoneRun = (run = {}) =>
  run.mode === "zones" ||
  Number(run.area || run.areaM2 || 0) > 0 ||
  run.zoneCoords?.length >= 3 ||
  run.zone?.coords?.length >= 3;

export default function useRunReplay({
  navigation,
  currentUserId,
  isActiveRun,
  onBeforeStart,
  onProgress,
  onFinish,
}) {
  const [replaying, setReplaying] = useState(false);
  const [replayPath, setReplayPath] = useState([]);
  const [replaySegments, setReplaySegments] = useState([]);
  const [replaySpeed, setReplaySpeed] = useState(1);
  const frameRef = useRef(null);
  const pathRef = useRef([]);
  const timelineRef = useRef([]);
  const lastFrameAtRef = useRef(null);
  const elapsedRef = useRef(0);
  const speedRef = useRef(1);
  const runRef = useRef(null);
  const returnRef = useRef(null);

  const clearPlayback = useCallback(() => {
    cancelFrame(frameRef.current);
    frameRef.current = null;
    lastFrameAtRef.current = null;
  }, []);

  const returnAfterReplay = useCallback((target) => {
    if (target?.type === "run-detail" && target.run) {
      navigation?.navigate("Corridas", { screen: "RunDetail", params: { run: target.run } });
    } else if (target?.type === "previous" && navigation?.canGoBack?.()) {
      navigation.goBack();
    }
  }, [navigation]);

  const cancelReplay = useCallback(() => {
    clearPlayback();
    pathRef.current = [];
    timelineRef.current = [];
    elapsedRef.current = 0;
    runRef.current = null;
    speedRef.current = 1;
    setReplaySpeed(1);
    setReplaying(false);
    setReplayPath([]);
    setReplaySegments([]);
  }, [clearPlayback]);

  const finishReplay = useCallback(({ shouldReturn = true } = {}) => {
    const returnTarget = returnRef.current;
    cancelReplay();
    returnRef.current = null;
    onFinish?.();
    if (shouldReturn) returnAfterReplay(returnTarget);
  }, [cancelReplay, onFinish, returnAfterReplay]);

  const advanceFrame = useCallback((frameTime) => {
    const timeline = timelineRef.current;
    const path = pathRef.current;
    if (timeline.length < 2 || path.length < 2) {
      finishReplay();
      return;
    }
    const now = Number(frameTime) || Date.now();
    const previousFrameAt = lastFrameAtRef.current ?? now;
    const deltaSeconds = Math.max(0, Math.min(0.35, (now - previousFrameAt) / 1000));
    lastFrameAtRef.current = now;
    elapsedRef.current += deltaSeconds * speedRef.current;
    const totalSeconds = Math.max(
      0.001,
      Number(timeline[timeline.length - 1]?.cumulativeTime) || 0.001
    );
    const visibleIndex = Math.min(
      Math.max(0, getReplayIndexForElapsed(timeline, elapsedRef.current)),
      path.length - 1
    );
    const visiblePath = path.slice(0, visibleIndex + 1);
    const point = timeline[visibleIndex];
    setReplayPath((current) => {
      const last = current[current.length - 1];
      const next = visiblePath[visiblePath.length - 1];
      return current.length === visiblePath.length &&
        last?.latitude === next?.latitude &&
        last?.longitude === next?.longitude
        ? current
        : visiblePath;
    });
    setReplaySegments(splitPathIntoSegments(visiblePath));
    onProgress?.({
      durationSeconds: Math.round(Number(point?.cumulativeTime) || elapsedRef.current),
      distanceMeters: Number(point?.cumulativeMeters) || 0,
    });
    if (elapsedRef.current >= totalSeconds || visibleIndex >= path.length - 1) {
      const stats = getReplayRunStats(runRef.current || {}, timeline);
      setReplayPath(path);
      setReplaySegments(splitPathIntoSegments(path));
      onProgress?.({
        durationSeconds: Math.round(stats.durationSeconds),
        distanceMeters: stats.distanceMeters,
      });
      finishReplay();
      return;
    }
    frameRef.current = requestFrame(advanceFrame);
  }, [finishReplay, onProgress]);

  const setReplayPlaybackSpeed = useCallback((nextSpeed) => {
    const speed = Math.max(1, Math.min(5, Number(nextSpeed) || 1));
    speedRef.current = speed;
    setReplaySpeed(speed);
  }, []);

  const startReplay = useCallback((run, options = {}) => {
    if (!run) return false;
    if (isActiveRun?.()) {
      Alert.alert("Replay indisponivel", "Finalize a corrida atual antes de reproduzir outra corrida.");
      if (options.returnTo) returnAfterReplay(options.returnTo);
      return false;
    }
    if (isZoneRun(run)) {
      Alert.alert("Replay indisponivel", "O replay esta disponivel apenas para corrida livre.");
      if (options.returnTo) returnAfterReplay(options.returnTo);
      return false;
    }
    if (
      run.readOnly ||
      options.readOnly ||
      !isRunOwnedByCurrentUser(run, currentUserId, {
        allowLegacyLocal: options.allowLegacyLocal === true,
      })
    ) {
      Alert.alert("Replay bloqueado", "Voce so pode reproduzir corridas do seu proprio historico.");
      if (options.returnTo) returnAfterReplay(options.returnTo);
      return false;
    }
    const replay = buildRunReplayTimeline(run);
    if (replay.path?.length < 2 || replay.timeline?.length < 2) {
      Alert.alert("Replay indisponivel", "Esta corrida nao possui pontos suficientes para reproducao.");
      if (options.returnTo) returnAfterReplay(options.returnTo);
      return false;
    }
    clearPlayback();
    const stats = getReplayRunStats(run, replay.timeline);
    onBeforeStart?.({ run, stats, initialPoint: replay.timeline[0] });
    runRef.current = run;
    returnRef.current = options.returnTo || null;
    pathRef.current = replay.path;
    timelineRef.current = replay.timeline;
    elapsedRef.current = 0;
    lastFrameAtRef.current = null;
    speedRef.current = 1;
    setReplaySpeed(1);
    setReplaying(true);
    setReplayPath([replay.path[0]]);
    setReplaySegments([]);
    frameRef.current = requestFrame(advanceFrame);
    return true;
  }, [advanceFrame, clearPlayback, currentUserId, isActiveRun, onBeforeStart, returnAfterReplay]);

  useEffect(() => clearPlayback, [clearPlayback]);

  return {
    replaying,
    replayPath,
    replaySegments,
    replaySpeed,
    replaySpeedOptions: [1, 2, 3, 4, 5],
    startReplay,
    stopReplay: finishReplay,
    cancelReplay,
    setReplayPlaybackSpeed,
  };
}

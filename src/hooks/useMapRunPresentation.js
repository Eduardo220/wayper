import { useCallback, useEffect, useRef, useState } from "react";
import { Animated } from "react-native";

export default function useMapRunPresentation({
  clearTerritoryFocusRef,
  paused,
  replaying,
  running,
  setDisplayRouteSegments,
  setDisplayRouteState,
  setRouteState,
}) {
  const [mapFollowEnabled, setMapFollowEnabled] = useState(true);
  const [mapRecenterSignal, setMapRecenterSignal] = useState(0);
  const liveTrackingRef = useRef(false);
  const routeFadeAnim = useRef(new Animated.Value(1)).current;
  const startPulseAnim = useRef(new Animated.Value(0)).current;
  const startPressAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const liveTracking = running && !paused && !replaying;
    if (liveTracking && !liveTrackingRef.current) {
      setMapFollowEnabled(true);
      setMapRecenterSignal((value) => value + 1);
    }
    if (!liveTracking && liveTrackingRef.current) setMapFollowEnabled(true);
    liveTrackingRef.current = liveTracking;
  }, [paused, replaying, running]);

  useEffect(() => {
    if (running || replaying) {
      startPulseAnim.stopAnimation();
      startPulseAnim.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(startPulseAnim, { toValue: 1, duration: 1800, useNativeDriver: true }),
      Animated.timing(startPulseAnim, { toValue: 0, duration: 1800, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [replaying, running, startPulseAnim]);

  const handleStartPressIn = useCallback(() => {
    Animated.spring(startPressAnim, {
      toValue: 0.975,
      speed: 22,
      bounciness: 5,
      useNativeDriver: true,
    }).start();
  }, [startPressAnim]);

  const handleStartPressOut = useCallback(() => {
    Animated.spring(startPressAnim, {
      toValue: 1,
      speed: 18,
      bounciness: 7,
      useNativeDriver: true,
    }).start();
  }, [startPressAnim]);

  const handleMapUserInteraction = useCallback(() => {
    if (running && !paused && !replaying) setMapFollowEnabled(false);
  }, [paused, replaying, running]);

  const disableMapFollow = useCallback(() => setMapFollowEnabled(false), []);
  const enableMapFollow = useCallback(() => setMapFollowEnabled(true), []);
  const recenterMapOnUser = useCallback(() => {
    clearTerritoryFocusRef.current?.();
    setMapFollowEnabled(true);
    setMapRecenterSignal((value) => value + 1);
  }, [clearTerritoryFocusRef]);

  const fadeOutRoute = useCallback(() => new Promise((resolve) => {
    try {
      routeFadeAnim.setValue(1);
      Animated.timing(routeFadeAnim, {
        toValue: 0,
        duration: 350,
        useNativeDriver: true,
      }).start(() => {
        setRouteState([]);
        setDisplayRouteState([]);
        setDisplayRouteSegments([]);
        resolve();
      });
    } catch {
      resolve();
    }
  }), [routeFadeAnim, setDisplayRouteSegments, setDisplayRouteState, setRouteState]);

  return {
    disableMapFollow,
    enableMapFollow,
    fadeOutRoute,
    handleMapUserInteraction,
    handleStartPressIn,
    handleStartPressOut,
    mapFollowEnabled,
    mapRecenterSignal,
    recenterMapOnUser,
    routeFadeAnim,
    startAuraOpacity: startPulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.16, 0.34] }),
    startPressAnim,
    startPulseAnim,
    startPulseScale: startPulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.018] }),
  };
}

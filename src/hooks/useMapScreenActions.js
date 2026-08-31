import { useCallback } from "react";
import { getCellIdForLocation } from "../services/territory";

function getPrimaryTerritoryCellId(territory) {
  if (Array.isArray(territory?.cellIds) && territory.cellIds.length > 0) return territory.cellIds[0];
  return getCellIdForLocation(territory?.center || territory);
}

export default function useMapScreenActions({
  closeSelectedTerritory,
  isRunStartBusy,
  lastSavedRun,
  navigation,
  selectedTerritory,
  setCompletedZonePreview,
  setSavedShareVisible,
  setSelectModeVisible,
  setShowRunModal,
  setShowRunsModal,
  setShowSavedModal,
  startReplay,
  startWithCountdown,
}) {
  const closeRunsModal = useCallback(() => setShowRunsModal(false), [setShowRunsModal]);
  const openRunDetails = useCallback((run) => {
    if (!run) return;
    setShowRunsModal(false);
    navigation?.navigate("Corridas", {
      screen: "RunDetail",
      params: {
        run,
        runId: run.id || run.localRunId || run.remoteRunId,
        localRunId: run.localRunId || null,
        remoteRunId: run.remoteRunId || null,
      },
    });
  }, [navigation, setShowRunsModal]);
  const openStartModal = useCallback(() => {
    if (!isRunStartBusy) setSelectModeVisible(true);
  }, [isRunStartBusy, setSelectModeVisible]);
  const runFromSelectedTerritory = useCallback(() => {
    closeSelectedTerritory();
    startWithCountdown("zones");
  }, [closeSelectedTerritory, startWithCountdown]);
  const openSelectedTerritoryRanking = useCallback(() => {
    const cellId = getPrimaryTerritoryCellId(selectedTerritory);
    closeSelectedTerritory();
    navigation?.navigate("Ranking", cellId ? { cellId } : undefined);
  }, [closeSelectedTerritory, navigation, selectedTerritory]);

  const closeSavedRunSurfaces = useCallback(() => {
    setShowSavedModal(false);
    setSavedShareVisible(false);
    setCompletedZonePreview([]);
    setShowRunModal(false);
    setShowRunsModal(false);
  }, [
    setCompletedZonePreview,
    setSavedShareVisible,
    setShowRunModal,
    setShowRunsModal,
    setShowSavedModal,
  ]);
  const goToSavedRunDetail = useCallback(() => {
    if (!lastSavedRun) return;
    closeSavedRunSurfaces();
    navigation?.closeDrawer?.();
    navigation?.navigate("Corridas", {
      screen: "RunDetail",
      params: {
        run: lastSavedRun,
        runId: lastSavedRun.id || lastSavedRun.localRunId || lastSavedRun.remoteRunId,
        localRunId: lastSavedRun.localRunId || null,
        remoteRunId: lastSavedRun.remoteRunId || null,
      },
    });
  }, [closeSavedRunSurfaces, lastSavedRun, navigation]);
  const replaySavedRun = useCallback(() => {
    if (!lastSavedRun) return;
    closeSavedRunSurfaces();
    navigation?.closeDrawer?.();
    navigation?.navigate("Mapa");
    setTimeout(() => startReplay(lastSavedRun, { allowLegacyLocal: true }), 220);
  }, [closeSavedRunSurfaces, lastSavedRun, navigation, startReplay]);

  return {
    closeRunsModal,
    goToSavedRunDetail,
    openRunDetails,
    openSelectedTerritoryRanking,
    openStartModal,
    replaySavedRun,
    runFromSelectedTerritory,
  };
}

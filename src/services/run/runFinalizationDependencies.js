import activeRunTrackingService from "../runTracking/activeRunTrackingService.js";
import { flushActiveRunCheckpoint } from "./runAutoSaveService.js";
import { markRecoveredRunLocallySaved, persistFinishedRunDraft } from "./runRecoveryService.js";
import { findLocalRunById, saveLocalRun, scheduleRunsSync } from "../../utils/sync.js";

const markRecoveredRunSaved = (options = {}) => markRecoveredRunLocallySaved({
  ...options,
  trackingService: activeRunTrackingService,
});

export const RUN_FINALIZATION_FREEZE_DEPENDENCIES = Object.freeze({
  trackingService: activeRunTrackingService,
  flushCheckpoint: flushActiveRunCheckpoint,
});

export const RUN_FINALIZATION_PERSISTENCE_DEPENDENCIES = Object.freeze({
  saveLocalRun,
  findLocalRunById,
  scheduleRunsSync,
  persistFinishedRunDraft,
  markRecoveredRunLocallySaved: markRecoveredRunSaved,
});

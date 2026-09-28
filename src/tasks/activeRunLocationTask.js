import * as TaskManager from "expo-task-manager";
import {
  ACTIVE_RUN_LOCATION_TASK,
  handleActiveRunLocationTask,
} from "../services/runTracking/activeRunTrackingService.js";
import { recordRunEvent } from "../services/diagnostics/runDiagnosticsService.js";
import { LOG_CATEGORIES } from "../utils/logger.js";

// Expo requires defineTask to run at module scope. This module is imported by
// index.js before the React tree, so the handler also exists in a cold/headless
// Android process and never depends on MapScreen being mounted.
try {
  const alreadyDefined =
    typeof TaskManager.isTaskDefined === "function" &&
    TaskManager.isTaskDefined(ACTIVE_RUN_LOCATION_TASK);

  if (typeof TaskManager.defineTask === "function" && !alreadyDefined) {
    TaskManager.defineTask(ACTIVE_RUN_LOCATION_TASK, handleActiveRunLocationTask);
  }

  recordRunEvent("RUN_BACKGROUND_TASK_REGISTERED", {
    taskName: ACTIVE_RUN_LOCATION_TASK,
    alreadyDefined,
  }, {
    category: LOG_CATEGORIES.BACKGROUND,
  });
} catch (error) {
  recordRunEvent("RUN_BACKGROUND_TASK_REGISTER_FAILED", {
    taskName: ACTIVE_RUN_LOCATION_TASK,
    error,
  }, {
    category: LOG_CATEGORIES.BACKGROUND,
  });
}

export default ACTIVE_RUN_LOCATION_TASK;

import { handleRunNotificationActionTask } from "./runNotificationService.js";

export default async function runNotificationActionTask(data = {}) {
  await handleRunNotificationActionTask(data);
}

export { runNotificationActionTask, handleRunNotificationActionTask };

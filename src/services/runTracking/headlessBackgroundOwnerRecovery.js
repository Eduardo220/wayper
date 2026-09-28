export async function recoverHeadlessBackgroundOwner({
  hasOwner,
  restoreActiveRun,
  runningStatus,
  startBackgroundLocationUpdates,
}) {
  if (hasOwner) return true;
  const snapshot = await restoreActiveRun({
    restartTracking: false,
    event: "headless_process_recovery",
  });
  if (!snapshot?.activeRunId || snapshot.status !== runningStatus) return false;
  return startBackgroundLocationUpdates({
    expectedRunId: snapshot.activeRunId,
    expectedStatuses: [runningStatus],
    reason: "headless_process_recovery_claim",
    ownerClaim: {
      mode: "process_recovery",
      reason: "canonical_snapshot_revalidated_by_headless_task",
    },
  });
}

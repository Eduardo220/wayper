import { useCallback } from "react";
import {
  openAppSettings,
  requestBackgroundLocationPermission,
  requestNotificationPermission,
} from "../services/permissions";

export default function useRunPermissionActions({
  lifecycle,
  run,
  startBackgroundLocationService,
}) {
  const { requestMapLocationPermission } = lifecycle;
  const {
    runLimitationNotice,
    setRunLimitationNotice,
    setRunPermissionNoticeVisible,
  } = run;

  const requestRequiredLocationPermission = useCallback(async () => {
    const permission = await requestMapLocationPermission();
    if (permission?.granted) setRunPermissionNoticeVisible(false);
  }, [requestMapLocationPermission, setRunPermissionNoticeVisible]);

  const requestRunLimitationPermission = useCallback(async () => {
    if (runLimitationNotice?.canAskAgain === false) {
      await openAppSettings();
      return;
    }
    if (runLimitationNotice?.type === "notification") {
      const permission = await requestNotificationPermission({ force: true });
      if (permission.granted) {
        setRunLimitationNotice(null);
        return;
      }
      setRunLimitationNotice((current) => ({
        ...(current || {}),
        title: permission.canAskAgain === false ? "Notificacao bloqueada" : "Notificacao desativada",
        status: permission.status,
        canAskAgain: permission.canAskAgain !== false,
        description: permission.canAskAgain === false
          ? "Libere notificacoes nas configuracoes para ver o painel persistente da corrida."
          : "A corrida segue no app. Voce pode tentar permitir notificacoes mais tarde.",
      }));
      return;
    }
    const permission = await requestBackgroundLocationPermission();
    if (permission.granted) {
      setRunLimitationNotice(null);
      await startBackgroundLocationService();
      return;
    }
    setRunLimitationNotice((current) => ({
      ...(current || {}),
      title: permission.canAskAgain === false ? "Background bloqueado" : "Background limitado",
      status: permission.status,
      canAskAgain: permission.canAskAgain !== false,
      description: permission.canAskAgain === false
        ? "Libere localizacao em segundo plano nas configuracoes para melhorar tela bloqueada."
        : "A corrida segue no app. Tela bloqueada pode registrar menos pontos.",
    }));
  }, [runLimitationNotice, setRunLimitationNotice, startBackgroundLocationService]);

  return {
    requestRequiredLocationPermission,
    requestRunLimitationPermission,
  };
}

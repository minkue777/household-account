import type {
  AndroidComponentName,
  AndroidHostAccessDecision,
  AndroidHostAccessInputPort,
  AndroidPermissionState,
} from "./ports/in/androidHostAccessInputPort";

function isSameComponent(
  candidate: AndroidComponentName,
  target: AndroidComponentName,
): boolean {
  return (
    candidate.packageName === target.packageName &&
    candidate.className === target.className
  );
}

class DefaultAndroidHostAccessApplication
  implements AndroidHostAccessInputPort
{
  decide(state: AndroidPermissionState): AndroidHostAccessDecision {
    // QuickEdit 선택은 표시 여부만 제어하며 최초 Host 권한 gate를 완화하지 않습니다.
    const notificationAccessGranted =
      state.enabledNotificationListenerComponents.some((candidate) =>
        isSameComponent(candidate, state.notificationListenerComponent),
      );
    const overlayGranted = state.canDrawOverlays;

    if (notificationAccessGranted && overlayGranted) {
      return { kind: "ShowWebShell" };
    }

    const actions: (
      | "OPEN_NOTIFICATION_LISTENER_SETTINGS"
      | "OPEN_OVERLAY_SETTINGS"
    )[] = [];
    if (!notificationAccessGranted) {
      actions.push("OPEN_NOTIFICATION_LISTENER_SETTINGS");
    }
    if (!overlayGranted) {
      actions.push("OPEN_OVERLAY_SETTINGS");
    }
    return {
      kind: "ShowPermissionGuide",
      notificationAccess: notificationAccessGranted ? "granted" : "missing",
      overlay: overlayGranted ? "granted" : "missing",
      actions,
    };
  }
}

export function createAndroidHostAccessApplication(): AndroidHostAccessInputPort {
  return new DefaultAndroidHostAccessApplication();
}

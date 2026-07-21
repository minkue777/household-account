import type { QuickEditOverlayPolicyInputPort } from "./ports/in/quickEditOverlayPolicyInputPort";

export function createQuickEditOverlayPolicyApplication(): QuickEditOverlayPolicyInputPort {
  return {
    decide(input) {
      if (input.entrySource !== "internal-capture") {
        return { kind: "Suppressed", reason: "EXTERNAL_ENTRY_REJECTED" };
      }
      if (!input.quickEditEnabled) {
        return { kind: "Suppressed", reason: "USER_DISABLED" };
      }
      if (input.transactionId === undefined || input.transactionId.trim().length === 0) {
        return { kind: "Suppressed", reason: "INVALID_TRANSACTION" };
      }
      if (!input.activeSession) {
        return { kind: "Suppressed", reason: "NO_ACTIVE_SESSION" };
      }
      return {
        kind: "Presented",
        presentation: {
          turnScreenOn: true,
          showAboveLockScreen: true,
          keyguard: "preserved",
          activityExport: "non-exported",
          screenshot: "allowed",
          screenRecording: "allowed",
          recentAppsPreview: "allowed",
        },
      };
    },
  };
}

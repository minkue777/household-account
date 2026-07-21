export type QuickEditOverlayDecision =
  | {
      readonly kind: "Presented";
      readonly presentation: {
        readonly turnScreenOn: true;
        readonly showAboveLockScreen: true;
        readonly keyguard: "preserved";
        readonly activityExport: "non-exported";
        readonly screenshot: "allowed";
        readonly screenRecording: "allowed";
        readonly recentAppsPreview: "allowed";
      };
    }
  | {
      readonly kind: "Suppressed";
      readonly reason:
        | "USER_DISABLED"
        | "INVALID_TRANSACTION"
        | "NO_ACTIVE_SESSION"
        | "EXTERNAL_ENTRY_REJECTED";
    };

export interface QuickEditOverlayPolicyInputPort {
  decide(input: {
    readonly quickEditEnabled: boolean;
    readonly activeSession: boolean;
    readonly transactionId?: string;
    readonly entrySource: "internal-capture" | "external-intent";
    readonly deviceLocked: boolean;
  }): QuickEditOverlayDecision;
}

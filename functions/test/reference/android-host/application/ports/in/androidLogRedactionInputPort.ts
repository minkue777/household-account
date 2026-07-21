export type AndroidLogSink = "logcat" | "crash-breadcrumb" | "analytics";

export interface SensitiveAndroidFlowInput {
  readonly operation:
    | "bridge"
    | "fcm-registration"
    | "notification-capture"
    | "quick-edit";
  readonly outcome: "success" | "failure";
  readonly errorCode: string;
  readonly householdId: string;
  readonly householdKey: string;
  readonly memberName: string;
  readonly fid: string;
  readonly registrationToken: string;
  readonly authToken: string;
  readonly notificationRaw: string;
  readonly transactionMemo: string;
}

export interface RedactedAndroidLogEntry {
  readonly sink: AndroidLogSink;
  readonly operation: SensitiveAndroidFlowInput["operation"];
  readonly outcome: SensitiveAndroidFlowInput["outcome"];
  readonly errorCode: string;
  readonly correlationHash?: string;
  readonly renderedMessage: string;
}

export type AndroidLogRecordResult = {
  readonly kind: "Recorded";
  readonly entries: readonly RedactedAndroidLogEntry[];
};

export interface AndroidLogRedactionState {
  readonly entries: readonly RedactedAndroidLogEntry[];
}

export interface AndroidLogRedactionInputPort {
  recordAcrossSinks(input: SensitiveAndroidFlowInput): AndroidLogRecordResult;
  state(): AndroidLogRedactionState;
}

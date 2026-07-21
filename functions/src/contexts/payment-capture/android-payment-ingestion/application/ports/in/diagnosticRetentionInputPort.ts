export interface DiagnosticActor {
  readonly householdId: string;
  readonly memberId: string;
  readonly role: "member" | "administrator" | "diagnostic-reader";
}

export interface DiagnosticNotification {
  readonly packageName: string;
  readonly sourceType: string;
  readonly title: string;
  readonly text: string;
  readonly bigText: string;
  readonly textLines: readonly string[];
  readonly fullText: string;
  readonly postedAtMillis: number;
  readonly collectedAt: string;
}

export interface DiagnosticDocument extends DiagnosticNotification {
  readonly diagnosticId: string;
  readonly householdId: string;
  readonly memberId: string;
}

export type DiagnosticBusinessOutcome = "Accepted" | "Ignored";

export type DiagnosticCollectionResult =
  | {
      readonly kind: "Collected";
      readonly diagnosticId: string;
      readonly businessOutcome: DiagnosticBusinessOutcome;
    }
  | {
      readonly kind: "Skipped";
      readonly reason: "ACTOR_REQUIRED" | "SOURCE_NOT_REGISTERED";
      readonly businessOutcome: DiagnosticBusinessOutcome;
    }
  | {
      readonly kind: "BestEffortFailure";
      readonly code: "DIAGNOSTIC_WRITE_FAILED";
      readonly businessOutcome: DiagnosticBusinessOutcome;
    };

export type DiagnosticReadResult =
  | { readonly kind: "Allowed"; readonly documents: readonly DiagnosticDocument[] }
  | { readonly kind: "Forbidden" };

export interface DiagnosticRetentionInputPort {
  collect(input: {
    readonly actor?: DiagnosticActor;
    readonly sourceRegistered: boolean;
    readonly notification: DiagnosticNotification;
    readonly businessOutcome: DiagnosticBusinessOutcome;
  }): Promise<DiagnosticCollectionResult>;
  readAll(actor: DiagnosticActor): Promise<DiagnosticReadResult>;
}

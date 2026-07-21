import type {
  DiagnosticDocument,
  DiagnosticNotification,
} from "../in/diagnosticRetentionInputPort";

export interface DiagnosticDocumentStore {
  write(input: {
    readonly actor: { readonly householdId: string; readonly memberId: string };
    readonly notification: DiagnosticNotification;
  }): Promise<
    | { readonly kind: "Written"; readonly diagnosticId: string }
    | { readonly kind: "Failed" }
  >;
  readAll(): Promise<readonly DiagnosticDocument[]>;
}

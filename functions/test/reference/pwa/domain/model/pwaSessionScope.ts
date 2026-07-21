export type PwaSessionCleanupState = "clean" | "required" | "isolated";

export type PwaSessionReadGate =
  | "open"
  | "blocked-until-authentication"
  | "blocked-cleanup-failed";

export interface PwaSessionScopeSnapshot {
  readonly generation?: string;
  readonly cleanupState: PwaSessionCleanupState;
}

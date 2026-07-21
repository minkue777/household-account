export type RequiredReleaseGate =
  | "web-build"
  | "functions-build"
  | "android-build"
  | "active-unit-tests"
  | "active-contract-tests"
  | "firestore-rules-emulator"
  | "requirement-id-trace"
  | "relative-link-check"
  | "architecture-fitness";

export type GateEvidenceStatus =
  | "passed"
  | "failed"
  | "missing"
  | "skipped"
  | "known-failure";

export interface TestRunSummary {
  readonly active: number;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly knownFailures: number;
}

export interface GateEvidence {
  readonly gate: RequiredReleaseGate;
  readonly status: GateEvidenceStatus;
  readonly testRun?: TestRunSummary;
}

export interface GateWaiver {
  readonly gate: RequiredReleaseGate;
  readonly scope: string;
  readonly reason: string;
  readonly approver: string;
  readonly expiresAt: string;
}

export interface ReleaseCandidateManifest {
  readonly releaseId: string;
  readonly commitSha: string;
  readonly environment: "production";
  readonly firebaseProjectId: "household-account-6f300";
  readonly artifacts: readonly { readonly name: string; readonly sha256: string }[];
  readonly contractVersion: string;
  readonly rulesHash: string;
  readonly indexesHash: string;
  readonly waivers?: readonly GateWaiver[];
}

export type ReleaseEvaluation =
  | {
      readonly kind: "approved";
      readonly gateResults: readonly GateEvidence[];
      readonly deployAuthorization: {
        readonly releaseId: string;
        readonly manifestHash: string;
      };
    }
  | {
      readonly kind: "rejected";
      readonly gateResults: readonly GateEvidence[];
      readonly failed: readonly {
        readonly gate: RequiredReleaseGate;
        readonly code: "GATE_FAILED" | "GATE_MISSING";
        readonly observedStatus: Exclude<GateEvidenceStatus, "passed">;
      }[];
      readonly waivers: readonly GateWaiver[];
    };

export interface ReleaseCandidateEvaluationInputPort {
  evaluate(manifest: ReleaseCandidateManifest): Promise<ReleaseEvaluation>;
}

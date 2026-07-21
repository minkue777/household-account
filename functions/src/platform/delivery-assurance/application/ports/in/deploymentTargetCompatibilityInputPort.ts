export interface DeploymentTargetCandidate {
  readonly environment: "development" | "test" | "production";
  readonly explicitProjectId?: string;
  readonly bindings: readonly {
    readonly resource:
      | "firebase-api"
      | "rules"
      | "indexes"
      | "secret"
      | "monitoring-channel";
    readonly target:
      | { readonly kind: "cloud-project"; readonly projectId: string; readonly httpsOrigin?: string }
      | { readonly kind: "emulator"; readonly authority: string };
  }[];
}

export type DeploymentTargetResolution =
  | {
      readonly kind: "resolved";
      readonly target:
        | {
            readonly environment: "production";
            readonly mode: "cloud-project";
            readonly projectId: "household-account-6f300";
          }
        | {
            readonly environment: "development" | "test";
            readonly mode: "emulator";
            readonly authorities: readonly string[];
          };
    }
  | { readonly kind: "rejected"; readonly code: "TARGET_MISMATCH" };

export type CompatibilityChange =
  | "fid-token-to-fid"
  | "legacy-membership-to-claims"
  | "generic-shared-contract";

export interface CompatibilityWindow {
  readonly oldContractVersion: string;
  readonly newContractVersion: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly minimumSupportedClients: Readonly<Record<string, string>>;
}

export interface CompatibilityStep {
  readonly phase: "expand" | "migrate" | "contract";
  readonly capabilities: readonly string[];
  readonly rollbackCheckpoint?: string;
}

export interface CompatibilityPlan {
  readonly change: CompatibilityChange;
  readonly window: CompatibilityWindow;
  readonly steps: readonly CompatibilityStep[];
}

export interface CompatibilityManifest {
  readonly releaseId: string;
  readonly sharedContractChanges: readonly CompatibilityChange[];
  readonly compatibilityPlans?: readonly CompatibilityPlan[];
}

export type CompatibilityEvaluation =
  | {
      readonly kind: "compatible";
      readonly windows: readonly CompatibilityWindow[];
      readonly rollbackCheckpoints: readonly string[];
    }
  | { readonly kind: "rejected"; readonly code: "INCOMPATIBLE_ORDER" };

export interface DeploymentTargetCompatibilityInputPort {
  resolveDeploymentTarget(candidate: DeploymentTargetCandidate): Promise<DeploymentTargetResolution>;
  verifyCompatibilityWindow(manifest: CompatibilityManifest): Promise<CompatibilityEvaluation>;
}

export interface ApprovedRelease {
  readonly releaseId: string;
  readonly manifestHash: string;
  readonly commitSha: string;
  readonly dependencyLockHash: string;
  readonly contractHash: string;
  readonly rulesHash: string;
  readonly indexesHash: string;
  readonly projectId: "household-account-6f300";
  readonly artifact: { readonly name: string; readonly sha256: string };
  readonly authorizedActorIds: readonly string[];
}

export interface RollbackEvidence {
  readonly strategy: "rollback" | "forward-fix";
  readonly checkpointId: string;
  readonly outcome: "succeeded" | "failed";
  readonly evidenceLink: string;
}

export interface DeploymentResultInput {
  readonly manifestHash: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly artifact: { readonly name: string; readonly sha256: string };
  readonly smoke:
    | { readonly status: "passed"; readonly artifactSha256: string }
    | {
        readonly status: "failed";
        readonly artifactSha256: string;
        readonly code: "SMOKE_FAILED";
      };
  readonly monitoringChannelReference: string;
  readonly adapterDiagnostics: readonly {
    readonly code: string;
    readonly rawMessage?: string;
    readonly artifactLink?: string;
  }[];
  readonly rollback?: RollbackEvidence;
}

export interface PublicDeploymentRecord {
  readonly deploymentId: string;
  readonly releaseId: string;
  readonly manifestHash: string;
  readonly commitSha: string;
  readonly dependencyLockHash: string;
  readonly contractHash: string;
  readonly rulesHash: string;
  readonly indexesHash: string;
  readonly projectId: "household-account-6f300";
  readonly actorId: string;
  readonly artifact: { readonly name: string; readonly sha256: string };
  readonly status: "completed" | "failed";
  readonly smoke: {
    readonly status: "passed" | "failed";
    readonly artifactSha256: string;
    readonly code?: "SMOKE_FAILED";
  };
  readonly monitoringChannelReference: string;
  readonly monitoringChannelVerification: {
    readonly status: "connected";
    readonly checkedAt: string;
  };
  readonly diagnostics: readonly { readonly code: string; readonly artifactLink?: string }[];
  readonly rollback?: RollbackEvidence;
  readonly recordedAt: string;
}

export type RecordDeploymentResult =
  | { readonly kind: "recorded"; readonly record: PublicDeploymentRecord }
  | { readonly kind: "replayed"; readonly record: PublicDeploymentRecord }
  | {
      readonly kind: "rejected";
      readonly code:
        | "ARTIFACT_MISMATCH"
        | "TARGET_MISMATCH"
        | "UNAPPROVED_RELEASE"
        | "UNAUTHORIZED_ACTOR"
        | "MONITORING_CHANNEL_UNVERIFIED"
        | "DEPLOYMENT_CONFLICT";
    };

export interface DeploymentProvenanceInputPort {
  recordDeploymentResult(
    releaseId: string,
    result: DeploymentResultInput,
  ): Promise<RecordDeploymentResult>;
  getDeploymentRecord(releaseId: string): Promise<PublicDeploymentRecord | undefined>;
}

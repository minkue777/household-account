import type {
  ApprovedRelease,
  PublicDeploymentRecord,
} from "../in/deploymentProvenanceInputPort";

export interface ApprovedReleaseQueryPort {
  get(releaseId: string): Promise<ApprovedRelease | undefined>;
}

export interface MonitoringChannelVerificationPort {
  isVerified(resource: string): Promise<boolean>;
}

export interface DeploymentRecordRepositoryPort {
  get(releaseId: string): Promise<PublicDeploymentRecord | undefined>;
  record(input: {
    readonly releaseId: string;
    readonly fingerprint: string;
    readonly candidate: PublicDeploymentRecord;
  }): Promise<
    | { readonly kind: "recorded"; readonly record: PublicDeploymentRecord }
    | { readonly kind: "replayed"; readonly record: PublicDeploymentRecord }
    | { readonly kind: "conflict" }
  >;
}

export interface DeploymentProvenanceIdentityPort {
  deploymentId(releaseId: string): string;
  fingerprint(value: unknown): string;
}

export interface DeploymentProvenanceClockPort {
  now(): string;
}

import type {
  DeploymentProvenanceInputPort,
  PublicDeploymentRecord,
} from "./ports/in/deploymentProvenanceInputPort";
import type {
  ApprovedReleaseQueryPort,
  DeploymentProvenanceClockPort,
  DeploymentProvenanceIdentityPort,
  DeploymentRecordRepositoryPort,
  MonitoringChannelVerificationPort,
} from "./ports/out/deploymentProvenancePorts";

export function createDeploymentProvenanceApplication(dependencies: {
  readonly releases: ApprovedReleaseQueryPort;
  readonly channels: MonitoringChannelVerificationPort;
  readonly records: DeploymentRecordRepositoryPort;
  readonly identity: DeploymentProvenanceIdentityPort;
  readonly clock: DeploymentProvenanceClockPort;
}): DeploymentProvenanceInputPort {
  return {
    async recordDeploymentResult(releaseId, input) {
      const release = await dependencies.releases.get(releaseId);
      if (release === undefined) {
        return { kind: "rejected", code: "UNAPPROVED_RELEASE" };
      }
      if (!release.authorizedActorIds.includes(input.actorId)) {
        return { kind: "rejected", code: "UNAUTHORIZED_ACTOR" };
      }
      if (
        input.manifestHash !== release.manifestHash ||
        input.artifact.name !== release.artifact.name ||
        input.artifact.sha256 !== release.artifact.sha256 ||
        input.smoke.artifactSha256 !== release.artifact.sha256
      ) {
        return { kind: "rejected", code: "ARTIFACT_MISMATCH" };
      }
      if (input.projectId !== release.projectId) {
        return { kind: "rejected", code: "TARGET_MISMATCH" };
      }
      const channelMatchesProject = input.monitoringChannelReference.startsWith(
        `projects/${release.projectId}/notificationChannels/`,
      );
      if (
        !channelMatchesProject ||
        !(await dependencies.channels.isVerified(input.monitoringChannelReference))
      ) {
        return { kind: "rejected", code: "MONITORING_CHANNEL_UNVERIFIED" };
      }

      const recordedAt = dependencies.clock.now();
      const record: PublicDeploymentRecord = {
        deploymentId: dependencies.identity.deploymentId(releaseId),
        releaseId,
        manifestHash: release.manifestHash,
        commitSha: release.commitSha,
        dependencyLockHash: release.dependencyLockHash,
        contractHash: release.contractHash,
        rulesHash: release.rulesHash,
        indexesHash: release.indexesHash,
        projectId: release.projectId,
        actorId: input.actorId,
        artifact: { ...input.artifact },
        status: input.smoke.status === "passed" ? "completed" : "failed",
        smoke: { ...input.smoke },
        monitoringChannelReference: input.monitoringChannelReference,
        monitoringChannelVerification: { status: "connected", checkedAt: recordedAt },
        diagnostics: input.adapterDiagnostics.map(({ code, artifactLink }) => ({
          code,
          ...(artifactLink === undefined ? {} : { artifactLink }),
        })),
        ...(input.rollback === undefined ? {} : { rollback: { ...input.rollback } }),
        recordedAt,
      };
      const fingerprint = dependencies.identity.fingerprint({
        releaseId,
        manifestHash: input.manifestHash,
        projectId: input.projectId,
        actorId: input.actorId,
        artifact: input.artifact,
        smoke: input.smoke,
        monitoringChannelReference: input.monitoringChannelReference,
        diagnostics: record.diagnostics,
        rollback: input.rollback,
      });
      const persisted = await dependencies.records.record({
        releaseId,
        fingerprint,
        candidate: record,
      });
      return persisted.kind === "conflict"
        ? { kind: "rejected", code: "DEPLOYMENT_CONFLICT" }
        : persisted;
    },
    getDeploymentRecord: (releaseId) => dependencies.records.get(releaseId),
  };
}

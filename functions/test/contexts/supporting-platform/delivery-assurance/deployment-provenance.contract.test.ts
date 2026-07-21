import { describe, expect, it } from "vitest";

import { createDeploymentProvenanceFixture } from "../../../support/deployment-provenance-fixture";

export interface ApprovedReleaseSeed {
  releaseId: string;
  manifestHash: string;
  commitSha: string;
  dependencyLockHash: string;
  contractHash: string;
  rulesHash: string;
  indexesHash: string;
  projectId: "household-account-6f300";
  artifact: { name: string; sha256: string };
  authorizedActorIds: readonly string[];
}

export interface DeploymentAdapterDiagnostic {
  code: string;
  rawMessage?: string;
  artifactLink?: string;
}

export interface RollbackEvidence {
  strategy: "rollback" | "forward-fix";
  checkpointId: string;
  outcome: "succeeded" | "failed";
  evidenceLink: string;
}

export interface DeploymentResultInput {
  manifestHash: string;
  projectId: string;
  actorId: string;
  artifact: { name: string; sha256: string };
  smoke:
    | { status: "passed"; artifactSha256: string }
    | {
        status: "failed";
        artifactSha256: string;
        code: "SMOKE_FAILED";
      };
  monitoringChannelReference: string;
  adapterDiagnostics: readonly DeploymentAdapterDiagnostic[];
  rollback?: RollbackEvidence;
}

export interface PublicDeploymentRecord {
  deploymentId: string;
  releaseId: string;
  manifestHash: string;
  commitSha: string;
  dependencyLockHash: string;
  contractHash: string;
  rulesHash: string;
  indexesHash: string;
  projectId: "household-account-6f300";
  actorId: string;
  artifact: { name: string; sha256: string };
  status: "completed" | "failed";
  smoke: {
    status: "passed" | "failed";
    artifactSha256: string;
    code?: "SMOKE_FAILED";
  };
  monitoringChannelReference: string;
  monitoringChannelVerification: {
    status: "connected";
    checkedAt: string;
  };
  diagnostics: readonly { code: string; artifactLink?: string }[];
  rollback?: RollbackEvidence;
  recordedAt: string;
}

export type RecordDeploymentResult =
  | { kind: "recorded"; record: PublicDeploymentRecord }
  | { kind: "replayed"; record: PublicDeploymentRecord }
  | {
      kind: "rejected";
      code:
        | "ARTIFACT_MISMATCH"
        | "TARGET_MISMATCH"
        | "UNAPPROVED_RELEASE"
        | "UNAUTHORIZED_ACTOR"
        | "MONITORING_CHANNEL_UNVERIFIED"
        | "DEPLOYMENT_CONFLICT";
    };

/** 승인된 artifact의 배포·smoke·rollback provenance를 기록하는 공개 계약입니다. */
export interface DeploymentProvenanceSubject {
  recordDeploymentResult(
    releaseId: string,
    result: DeploymentResultInput,
  ): Promise<RecordDeploymentResult>;
  getDeploymentRecord(
    releaseId: string,
  ): Promise<PublicDeploymentRecord | undefined>;
}

export function createSubject(_fixture: {
  now: string;
  approvedReleases: readonly ApprovedReleaseSeed[];
  verifiedMonitoringChannels: readonly string[];
  /** Adapter 오류에 섞여 들어올 수 있는 원문을 검증하기 위한 테스트 driver 값입니다. */
  secretMaterial: readonly string[];
}): DeploymentProvenanceSubject {
  return createDeploymentProvenanceFixture(_fixture);
}

const approvedRelease: ApprovedReleaseSeed = {
  releaseId: "release-1",
  manifestHash: "manifest-sha256",
  commitSha: "commit-sha",
  dependencyLockHash: "lock-sha256",
  contractHash: "contract-sha256",
  rulesHash: "rules-sha256",
  indexesHash: "indexes-sha256",
  projectId: "household-account-6f300",
  artifact: { name: "firebase-bundle", sha256: "artifact-sha256" },
  authorizedActorIds: ["operations-admin"],
};

const monitoringChannel =
  "projects/household-account-6f300/notificationChannels/operations-email";

const subjectFixture = (overrides: {
  approvedReleases?: readonly ApprovedReleaseSeed[];
  verifiedMonitoringChannels?: readonly string[];
  secretMaterial?: readonly string[];
} = {}) => ({
  now: "2026-07-19T09:00:00.000Z",
  approvedReleases: [approvedRelease],
  verifiedMonitoringChannels: [monitoringChannel],
  secretMaterial: [] as readonly string[],
  ...overrides,
});

const successfulResult = (
  overrides: Partial<DeploymentResultInput> = {},
): DeploymentResultInput => ({
  manifestHash: approvedRelease.manifestHash,
  projectId: approvedRelease.projectId,
  actorId: "operations-admin",
  artifact: approvedRelease.artifact,
  smoke: {
    status: "passed",
    artifactSha256: approvedRelease.artifact.sha256,
  },
  monitoringChannelReference:
    monitoringChannel,
  adapterDiagnostics: [],
  ...overrides,
});

describe("배포 결과·rollback·Secret redaction 공개 계약", () => {
  it("[T-REL-004][REL-004/DEC-046] 완료 기록은 commit·lock·계약·Rules·index·artifact와 smoke·경보 channel을 장기 추적한다", async () => {
    const subject = createSubject(subjectFixture());

    const result = await subject.recordDeploymentResult(
      approvedRelease.releaseId,
      successfulResult(),
    );

    expect(result.kind).toBe("recorded");
    if (result.kind !== "recorded") return;
    expect(result.record).toEqual({
      deploymentId: expect.any(String),
      releaseId: approvedRelease.releaseId,
      manifestHash: approvedRelease.manifestHash,
      commitSha: approvedRelease.commitSha,
      dependencyLockHash: approvedRelease.dependencyLockHash,
      contractHash: approvedRelease.contractHash,
      rulesHash: approvedRelease.rulesHash,
      indexesHash: approvedRelease.indexesHash,
      projectId: approvedRelease.projectId,
      actorId: "operations-admin",
      artifact: approvedRelease.artifact,
      status: "completed",
      smoke: {
        status: "passed",
        artifactSha256: approvedRelease.artifact.sha256,
      },
      monitoringChannelReference:
        monitoringChannel,
      monitoringChannelVerification: {
        status: "connected",
        checkedAt: "2026-07-19T09:00:00.000Z",
      },
      diagnostics: [],
      recordedAt: "2026-07-19T09:00:00.000Z",
    });
    expect(result.record).not.toHaveProperty("expiresAt");
    expect(await subject.getDeploymentRecord(approvedRelease.releaseId)).toEqual(
      result.record,
    );
  });

  it("[T-REL-004][REL-004] 실패한 smoke를 성공으로 축약하지 않고 rollback 근거와 구조화된 진단만 보존한다", async () => {
    const rawSecret = "server-secret-value";
    const rollback: RollbackEvidence = {
      strategy: "rollback",
      checkpointId: "before-contract-phase",
      outcome: "succeeded",
      evidenceLink: "artifact://rollback/release-1",
    };
    const subject = createSubject(
      subjectFixture({ secretMaterial: [rawSecret] }),
    );

    const result = await subject.recordDeploymentResult(
      approvedRelease.releaseId,
      successfulResult({
        smoke: {
          status: "failed",
          artifactSha256: approvedRelease.artifact.sha256,
          code: "SMOKE_FAILED",
        },
        adapterDiagnostics: [
          {
            code: "SMOKE_QUERY_FAILED",
            rawMessage: `credential=${rawSecret}; householdId=private-fixture`,
            artifactLink: "artifact://smoke/release-1",
          },
        ],
        rollback,
      }),
    );

    expect(result.kind).toBe("recorded");
    if (result.kind !== "recorded") return;
    expect(result.record).toEqual(
      expect.objectContaining({
        status: "failed",
        smoke: {
          status: "failed",
          artifactSha256: approvedRelease.artifact.sha256,
          code: "SMOKE_FAILED",
        },
        diagnostics: [
          {
            code: "SMOKE_QUERY_FAILED",
            artifactLink: "artifact://smoke/release-1",
          },
        ],
        rollback,
      }),
    );
    const serialized = JSON.stringify(result.record);
    expect(serialized).not.toContain(rawSecret);
    expect(serialized).not.toContain("private-fixture");
    expect(serialized).not.toContain("rawMessage");
  });

  it.each([
    {
      name: "manifest hash 불일치",
      result: successfulResult({ manifestHash: "other-manifest" }),
      code: "ARTIFACT_MISMATCH" as const,
    },
    {
      name: "artifact hash 불일치",
      result: successfulResult({
        artifact: { name: "firebase-bundle", sha256: "other-artifact" },
      }),
      code: "ARTIFACT_MISMATCH" as const,
    },
    {
      name: "smoke 대상 artifact hash 불일치",
      result: successfulResult({
        smoke: { status: "passed", artifactSha256: "other-artifact" },
      }),
      code: "ARTIFACT_MISMATCH" as const,
    },
    {
      name: "project target 불일치",
      result: successfulResult({ projectId: "another-project" }),
      code: "TARGET_MISMATCH" as const,
    },
  ])(
    "[T-REL-004][REL-004] $name 결과는 provenance를 기록하지 않는다",
    async ({ result, code }) => {
      const subject = createSubject(subjectFixture());

      await expect(
        subject.recordDeploymentResult(approvedRelease.releaseId, result),
      ).resolves.toEqual({ kind: "rejected", code });
      await expect(
        subject.getDeploymentRecord(approvedRelease.releaseId),
      ).resolves.toBeUndefined();
    },
  );

  it("[T-REL-004][REL-004] 같은 release·project·artifact 결과의 재시도는 최초 immutable 기록을 재생한다", async () => {
    const subject = createSubject(subjectFixture());
    const input = successfulResult();

    const first = await subject.recordDeploymentResult(
      approvedRelease.releaseId,
      input,
    );
    const replay = await subject.recordDeploymentResult(
      approvedRelease.releaseId,
      input,
    );

    expect(first.kind).toBe("recorded");
    expect(replay.kind).toBe("replayed");
    if (first.kind !== "recorded" || replay.kind !== "replayed") return;
    expect(replay.record).toEqual(first.record);
    expect(await subject.getDeploymentRecord(approvedRelease.releaseId)).toEqual(
      first.record,
    );
  });

  it("[T-REL-004][REL-004] 최초 기록 뒤 smoke 결과가 달라진 재전송은 immutable 기록을 덮지 않는다", async () => {
    const subject = createSubject(subjectFixture());
    const first = await subject.recordDeploymentResult(
      approvedRelease.releaseId,
      successfulResult(),
    );

    expect(
      await subject.recordDeploymentResult(
        approvedRelease.releaseId,
        successfulResult({
          smoke: {
            status: "failed",
            artifactSha256: approvedRelease.artifact.sha256,
            code: "SMOKE_FAILED",
          },
        }),
      ),
    ).toEqual({ kind: "rejected", code: "DEPLOYMENT_CONFLICT" });
    expect(await subject.getDeploymentRecord(approvedRelease.releaseId)).toEqual(
      first.kind === "recorded" ? first.record : undefined,
    );
  });

  it("[T-REL-004][REL-004] failed smoke의 forward-fix 근거도 rollback과 같은 provenance로 보존한다", async () => {
    const forwardFix: RollbackEvidence = {
      strategy: "forward-fix",
      checkpointId: "after-expand",
      outcome: "succeeded",
      evidenceLink: "artifact://forward-fix/release-1",
    };
    const result = await createSubject(subjectFixture()).recordDeploymentResult(
      approvedRelease.releaseId,
      successfulResult({
        smoke: {
          status: "failed",
          artifactSha256: approvedRelease.artifact.sha256,
          code: "SMOKE_FAILED",
        },
        rollback: forwardFix,
      }),
    );

    expect(result).toMatchObject({
      kind: "recorded",
      record: { status: "failed", rollback: forwardFix },
    });
  });

  it("[T-REL-004][REL-004] verified 목록에 있어도 다른 project의 monitoring channel은 거부한다", async () => {
    const foreign = "projects/another-project/notificationChannels/operations-email";
    const subject = createSubject(
      subjectFixture({ verifiedMonitoringChannels: [foreign] }),
    );

    expect(
      await subject.recordDeploymentResult(
        approvedRelease.releaseId,
        successfulResult({ monitoringChannelReference: foreign }),
      ),
    ).toEqual({ kind: "rejected", code: "MONITORING_CHANNEL_UNVERIFIED" });
  });

  it.each([
    {
      name: "승인 manifest가 없는 release",
      releaseId: "unapproved-release",
      result: successfulResult(),
      fixture: subjectFixture(),
      code: "UNAPPROVED_RELEASE" as const,
    },
    {
      name: "승인되지 않은 배포 Actor",
      releaseId: approvedRelease.releaseId,
      result: successfulResult({ actorId: "unknown-operator" }),
      fixture: subjectFixture(),
      code: "UNAUTHORIZED_ACTOR" as const,
    },
    {
      name: "provision·연결이 확인되지 않은 경보 channel",
      releaseId: approvedRelease.releaseId,
      result: successfulResult({
        monitoringChannelReference:
          "projects/household-account-6f300/notificationChannels/unverified",
      }),
      fixture: subjectFixture({ verifiedMonitoringChannels: [] }),
      code: "MONITORING_CHANNEL_UNVERIFIED" as const,
    },
  ])(
    "[T-REL-004][REL-004] $name 결과는 write 없이 $code로 거부한다",
    async ({ releaseId, result, fixture, code }) => {
      const subject = createSubject(fixture);

      await expect(
        subject.recordDeploymentResult(releaseId, result),
      ).resolves.toEqual({ kind: "rejected", code });
      await expect(subject.getDeploymentRecord(releaseId)).resolves.toBeUndefined();
    },
  );

  it("[T-REL-004][REL-004] 같은 releaseId의 서로 다른 결과가 경합하면 immutable 기록 하나만 남긴다", async () => {
    const subject = createSubject(subjectFixture());
    const completed = successfulResult();
    const failed = successfulResult({
      smoke: {
        status: "failed",
        artifactSha256: approvedRelease.artifact.sha256,
        code: "SMOKE_FAILED",
      },
    });

    const results = await Promise.all([
      subject.recordDeploymentResult(approvedRelease.releaseId, completed),
      subject.recordDeploymentResult(approvedRelease.releaseId, failed),
    ]);

    expect(results.filter(({ kind }) => kind === "recorded")).toHaveLength(1);
    expect(results).toContainEqual({
      kind: "rejected",
      code: "DEPLOYMENT_CONFLICT",
    });
    const stored = await subject.getDeploymentRecord(approvedRelease.releaseId);
    expect(stored).toBeDefined();
    expect(["completed", "failed"]).toContain(stored?.status);
  });
});

import { describe, expect, it } from "vitest";

import { createDeploymentTargetCompatibilityFixture } from "../../../support/deployment-target-compatibility-fixture";

export interface DeploymentTargetCandidate {
  environment: "development" | "test" | "production";
  explicitProjectId?: string;
  bindings: readonly {
    resource:
      | "firebase-api"
      | "rules"
      | "indexes"
      | "secret"
      | "monitoring-channel";
    target:
      | { kind: "cloud-project"; projectId: string; httpsOrigin?: string }
      | { kind: "emulator"; authority: string };
  }[];
}

export type DeploymentTargetResolution =
  | {
      kind: "resolved";
      target:
        | {
            environment: "production";
            mode: "cloud-project";
            projectId: "household-account-6f300";
          }
        | {
            environment: "development" | "test";
            mode: "emulator";
            authorities: readonly string[];
          };
    }
  | { kind: "rejected"; code: "TARGET_MISMATCH" };

export type CompatibilityChange =
  | "fid-token-to-fid"
  | "legacy-membership-to-claims"
  | "generic-shared-contract";

export interface CompatibilityWindow {
  oldContractVersion: string;
  newContractVersion: string;
  startsAt: string;
  endsAt: string;
  minimumSupportedClients: Readonly<Record<string, string>>;
}

export interface CompatibilityStep {
  phase: "expand" | "migrate" | "contract";
  capabilities: readonly string[];
  rollbackCheckpoint?: string;
}

export interface CompatibilityPlan {
  change: CompatibilityChange;
  window: CompatibilityWindow;
  steps: readonly CompatibilityStep[];
}

export interface CompatibilityManifest {
  releaseId: string;
  sharedContractChanges: readonly CompatibilityChange[];
  compatibilityPlans?: readonly CompatibilityPlan[];
}

export type CompatibilityEvaluation =
  | {
      kind: "compatible";
      windows: readonly CompatibilityWindow[];
      rollbackCheckpoints: readonly string[];
    }
  | { kind: "rejected"; code: "INCOMPATIBLE_ORDER" };

/** 운영 target binding과 공유 계약 호환 창을 검증하는 공개 계약입니다. */
export interface DeploymentTargetCompatibilitySubject {
  resolveDeploymentTarget(
    candidate: DeploymentTargetCandidate,
  ): Promise<DeploymentTargetResolution>;
  verifyCompatibilityWindow(
    manifest: CompatibilityManifest,
  ): Promise<CompatibilityEvaluation>;
}

export function createSubject(): DeploymentTargetCompatibilitySubject {
  return createDeploymentTargetCompatibilityFixture();
}

const productionBindings = (): DeploymentTargetCandidate["bindings"] => [
  {
    resource: "firebase-api",
    target: {
      kind: "cloud-project",
      projectId: "household-account-6f300",
      httpsOrigin: "https://household-account-6f300.web.app",
    },
  },
  {
    resource: "rules",
    target: {
      kind: "cloud-project",
      projectId: "household-account-6f300",
    },
  },
  {
    resource: "indexes",
    target: {
      kind: "cloud-project",
      projectId: "household-account-6f300",
    },
  },
  {
    resource: "secret",
    target: {
      kind: "cloud-project",
      projectId: "household-account-6f300",
    },
  },
  {
    resource: "monitoring-channel",
    target: {
      kind: "cloud-project",
      projectId: "household-account-6f300",
    },
  },
];

const targetCandidate = (
  overrides: Partial<DeploymentTargetCandidate> = {},
): DeploymentTargetCandidate => ({
  environment: "production",
  explicitProjectId: "household-account-6f300",
  bindings: productionBindings(),
  ...overrides,
});

const window: CompatibilityWindow = {
  oldContractVersion: "1.0.0",
  newContractVersion: "2.0.0",
  startsAt: "2026-07-19T00:00:00.000Z",
  endsAt: "2026-08-19T00:00:00.000Z",
  minimumSupportedClients: {
    android: "1.12.0",
    web: "2026.07.19",
  },
};

const plan = (
  change: CompatibilityChange,
  steps: readonly CompatibilityStep[],
  overrides: Partial<CompatibilityPlan> = {},
): CompatibilityPlan => ({ change, window, steps, ...overrides });

const fidSteps = (): CompatibilityStep[] => [
  {
    phase: "expand",
    capabilities: ["fid-client-registration", "fid-endpoint-dual-read"],
    rollbackCheckpoint: "before-fid-expand",
  },
  {
    phase: "expand",
    capabilities: ["fid-admin-sender"],
    rollbackCheckpoint: "before-fid-sender",
  },
  {
    phase: "migrate",
    capabilities: ["fid-registration-observed"],
    rollbackCheckpoint: "before-fid-contract",
  },
  {
    phase: "contract",
    capabilities: ["legacy-token-reader-writer-removed"],
    rollbackCheckpoint: "restore-legacy-token-path",
  },
];

describe("운영 대상 resolution과 공유 계약 호환 창 공개 계약", () => {
  it("[T-REL-002][REL-002/DEC-050] 모든 운영 binding이 명시한 단일 production project와 일치할 때만 target을 resolve한다", async () => {
    const subject = createSubject();

    await expect(
      subject.resolveDeploymentTarget(targetCandidate()),
    ).resolves.toEqual({
      kind: "resolved",
      target: {
        environment: "production",
        mode: "cloud-project",
        projectId: "household-account-6f300",
      },
    });
  });

  it.each([
    {
      name: "암묵적 default project",
      candidate: targetCandidate({ explicitProjectId: undefined }),
    },
    {
      name: "Firebase API URL이 다른 project origin을 가리킴",
      candidate: targetCandidate({
        bindings: productionBindings().map((binding) =>
          binding.resource === "firebase-api"
            ? {
                resource: "firebase-api" as const,
                target: {
                  kind: "cloud-project" as const,
                  projectId: "household-account-6f300",
                  httpsOrigin: "https://another-project.web.app",
                },
              }
            : binding,
        ),
      }),
    },
    {
      name: "다른 cloud project",
      candidate: targetCandidate({ explicitProjectId: "another-project" }),
    },
    {
      name: "production과 Emulator 혼합",
      candidate: targetCandidate({
        bindings: productionBindings().map((binding) =>
          binding.resource === "rules"
            ? {
                resource: "rules" as const,
                target: {
                  kind: "emulator" as const,
                  authority: "127.0.0.1:8080",
                },
              }
            : binding,
        ),
      }),
    },
    {
      name: "Monitoring channel binding 누락",
      candidate: targetCandidate({
        bindings: productionBindings().filter(
          ({ resource }) => resource !== "monitoring-channel",
        ),
      }),
    },
    {
      name: "index가 다른 project를 가리킴",
      candidate: targetCandidate({
        bindings: productionBindings().map((binding) =>
          binding.resource === "indexes"
            ? {
                resource: "indexes" as const,
                target: {
                  kind: "cloud-project" as const,
                  projectId: "another-project",
                },
              }
            : binding,
        ),
      }),
    },
  ])(
    "[T-REL-002][REL-002/DEC-050] $name 후보는 운영 target을 얻지 못한다",
    async ({ candidate }) => {
      const subject = createSubject();

      await expect(subject.resolveDeploymentTarget(candidate)).resolves.toEqual(
        { kind: "rejected", code: "TARGET_MISMATCH" },
      );
    },
  );

  it.each([
    "firebase-api",
    "rules",
    "indexes",
    "secret",
    "monitoring-channel",
  ] as const)(
    "[T-REL-002][REL-002] 필수 %s binding이 누락된 production 후보를 거부한다",
    async (missingResource) => {
      await expect(
        createSubject().resolveDeploymentTarget(
          targetCandidate({
            bindings: productionBindings().filter(
              ({ resource }) => resource !== missingResource,
            ),
          }),
        ),
      ).resolves.toEqual({ kind: "rejected", code: "TARGET_MISMATCH" });
    },
  );

  it("[T-REL-002][REL-002/DEC-050] development·test는 cloud binding 없이 필수 자원을 로컬 Emulator로 resolve한다", async () => {
    const bindings: DeploymentTargetCandidate["bindings"] = [
      ["firebase-api", "127.0.0.1:5001"],
      ["rules", "127.0.0.1:8080"],
      ["indexes", "127.0.0.1:8080"],
      ["secret", "127.0.0.1:5001"],
      ["monitoring-channel", "127.0.0.1:5001"],
    ].map(([resource, authority]) => ({
      resource: resource as DeploymentTargetCandidate["bindings"][number]["resource"],
      target: { kind: "emulator" as const, authority },
    }));

    await expect(
      createSubject().resolveDeploymentTarget({
        environment: "development",
        bindings,
      }),
    ).resolves.toEqual({
      kind: "resolved",
      target: {
        environment: "development",
        mode: "emulator",
        authorities: ["127.0.0.1:5001", "127.0.0.1:8080"],
      },
    });
  });

  it("[T-REL-002][REL-002/DEC-050] test 환경도 같은 필수 Emulator binding으로 resolve한다", async () => {
    const bindings: DeploymentTargetCandidate["bindings"] = [
      ["firebase-api", "127.0.0.1:5001"],
      ["rules", "127.0.0.1:8080"],
      ["indexes", "127.0.0.1:8080"],
      ["secret", "127.0.0.1:5001"],
      ["monitoring-channel", "127.0.0.1:5001"],
    ].map(([resource, authority]) => ({
      resource: resource as DeploymentTargetCandidate["bindings"][number]["resource"],
      target: { kind: "emulator" as const, authority },
    }));

    await expect(
      createSubject().resolveDeploymentTarget({ environment: "test", bindings }),
    ).resolves.toMatchObject({
      kind: "resolved",
      target: { environment: "test", mode: "emulator" },
    });
  });

  it.each([
    {
      name: "개발 환경의 cloud binding",
      candidate: { ...targetCandidate(), environment: "development" as const },
    },
    {
      name: "운영 필수 binding 중복",
      candidate: targetCandidate({
        bindings: [...productionBindings(), productionBindings()[0]],
      }),
    },
  ])("[T-REL-002][REL-002] $name 후보는 target을 얻지 못한다", async ({ candidate }) => {
    await expect(createSubject().resolveDeploymentTarget(candidate)).resolves.toEqual({
      kind: "rejected",
      code: "TARGET_MISMATCH",
    });
  });

  it("[T-REL-003][REL-003] 공유 계약 변경은 구·신 version 지원 창과 단계별 rollback checkpoint를 모두 공개한다", async () => {
    const subject = createSubject();
    const fidPlan = plan("fid-token-to-fid", fidSteps());

    const result = await subject.verifyCompatibilityWindow({
      releaseId: "release-fid",
      sharedContractChanges: ["fid-token-to-fid"],
      compatibilityPlans: [fidPlan],
    });

    expect(result).toEqual({
      kind: "compatible",
      windows: [window],
      rollbackCheckpoints: [
        "before-fid-expand",
        "before-fid-sender",
        "before-fid-contract",
        "restore-legacy-token-path",
      ],
    });
  });

  it.each([
    {
      name: "호환 계획이 없음",
      plans: undefined,
    },
    {
      name: "구·신 version 호환 창이 역전됨",
      plans: [
        plan("fid-token-to-fid", fidSteps(), {
          window: {
            ...window,
            startsAt: "2026-08-19T00:00:00.000Z",
            endsAt: "2026-07-19T00:00:00.000Z",
          },
        }),
      ],
    },
    {
      name: "rollback checkpoint가 누락됨",
      plans: [
        plan(
          "fid-token-to-fid",
          fidSteps().map((step) =>
            step.phase === "migrate"
              ? { ...step, rollbackCheckpoint: undefined }
              : step,
          ),
        ),
      ],
    },
  ])(
    "[T-REL-003][REL-003] $name 상태에서는 호환 배포를 승인하지 않는다",
    async ({ plans }) => {
      const subject = createSubject();

      await expect(
        subject.verifyCompatibilityWindow({
          releaseId: "release-invalid-window",
          sharedContractChanges: ["fid-token-to-fid"],
          compatibilityPlans: plans,
        }),
      ).resolves.toEqual({ kind: "rejected", code: "INCOMPATIBLE_ORDER" });
    },
  );

  it.each([
    {
      name: "같은 구·신 contract version",
      plan: plan("generic-shared-contract", [
        { phase: "expand", capabilities: ["dual"], rollbackCheckpoint: "a" },
        { phase: "migrate", capabilities: ["observed"], rollbackCheckpoint: "b" },
        { phase: "contract", capabilities: ["removed"], rollbackCheckpoint: "c" },
      ], { window: { ...window, newContractVersion: window.oldContractVersion } }),
    },
    {
      name: "phase 역전",
      plan: plan("generic-shared-contract", [
        { phase: "migrate", capabilities: ["observed"], rollbackCheckpoint: "b" },
        { phase: "expand", capabilities: ["dual"], rollbackCheckpoint: "a" },
        { phase: "contract", capabilities: ["removed"], rollbackCheckpoint: "c" },
      ]),
    },
  ])("[T-REL-003][REL-003] $name 계획은 호환 배포를 승인하지 않는다", async ({ plan: invalidPlan }) => {
    await expect(
      createSubject().verifyCompatibilityWindow({
        releaseId: "release-invalid-order",
        sharedContractChanges: ["generic-shared-contract"],
        compatibilityPlans: [invalidPlan],
      }),
    ).resolves.toEqual({ kind: "rejected", code: "INCOMPATIBLE_ORDER" });
  });

  it("[T-REL-003][REL-003/DEC-019] FID client 등록·dual-read 전에 Admin sender를 전환하는 계획을 거부한다", async () => {
    const subject = createSubject();
    const unsafeSteps = fidSteps();
    unsafeSteps[0] = {
      ...unsafeSteps[0],
      capabilities: ["fid-admin-sender"],
    };
    unsafeSteps[1] = {
      ...unsafeSteps[1],
      capabilities: ["fid-client-registration", "fid-endpoint-dual-read"],
    };

    await expect(
      subject.verifyCompatibilityWindow({
        releaseId: "release-unsafe-fid",
        sharedContractChanges: ["fid-token-to-fid"],
        compatibilityPlans: [plan("fid-token-to-fid", unsafeSteps)],
      }),
    ).resolves.toEqual({ kind: "rejected", code: "INCOMPATIBLE_ORDER" });
  });

  it("[T-REL-003][REL-003/DEC-021] claim 호환 client/server와 연결 관측 전에 public Rules를 차단하는 계획을 거부한다", async () => {
    const subject = createSubject();
    const unsafeClaimPlan = plan("legacy-membership-to-claims", [
      {
        phase: "expand",
        capabilities: ["direct-public-rules-blocked"],
        rollbackCheckpoint: "restore-public-rules",
      },
      {
        phase: "expand",
        capabilities: ["claim-compatible-client", "claim-compatible-rules"],
        rollbackCheckpoint: "before-claim-client",
      },
      {
        phase: "migrate",
        capabilities: ["membership-claim-observed", "server-command-read"],
        rollbackCheckpoint: "before-server-command",
      },
      {
        phase: "contract",
        capabilities: ["legacy-direct-access-removed"],
        rollbackCheckpoint: "restore-legacy-access",
      },
    ]);

    await expect(
      subject.verifyCompatibilityWindow({
        releaseId: "release-unsafe-claims",
        sharedContractChanges: ["legacy-membership-to-claims"],
        compatibilityPlans: [unsafeClaimPlan],
      }),
    ).resolves.toEqual({ kind: "rejected", code: "INCOMPATIBLE_ORDER" });
  });

  it("[T-REL-003][REL-003] 여러 공유 변경은 각각 정확히 한 계획과 expand→migrate→contract 전이를 가져야 한다", async () => {
    const genericSteps: CompatibilityStep[] = [
      {
        phase: "expand",
        capabilities: ["generic-v1-v2-dual-read"],
        rollbackCheckpoint: "generic-before-expand",
      },
      {
        phase: "migrate",
        capabilities: ["generic-v2-observed"],
        rollbackCheckpoint: "generic-before-migrate",
      },
      {
        phase: "contract",
        capabilities: ["generic-v1-removed"],
        rollbackCheckpoint: "generic-restore-v1",
      },
    ];

    await expect(
      createSubject().verifyCompatibilityWindow({
        releaseId: "release-two-contracts",
        sharedContractChanges: ["fid-token-to-fid", "generic-shared-contract"],
        compatibilityPlans: [
          plan("fid-token-to-fid", fidSteps()),
          plan("generic-shared-contract", genericSteps),
        ],
      }),
    ).resolves.toEqual({
      kind: "compatible",
      windows: [window, window],
      rollbackCheckpoints: [
        "before-fid-expand",
        "before-fid-sender",
        "before-fid-contract",
        "restore-legacy-token-path",
        "generic-before-expand",
        "generic-before-migrate",
        "generic-restore-v1",
      ],
    });
  });

  it.each([
    {
      name: "한 변경의 계획 누락",
      changes: ["fid-token-to-fid", "generic-shared-contract"] as const,
      plans: [plan("fid-token-to-fid", fidSteps())],
    },
    {
      name: "같은 변경의 계획 중복",
      changes: ["generic-shared-contract"] as const,
      plans: [
        plan("generic-shared-contract", [
          { phase: "expand", capabilities: ["dual"], rollbackCheckpoint: "a" },
          { phase: "migrate", capabilities: ["observed"], rollbackCheckpoint: "b" },
          { phase: "contract", capabilities: ["removed"], rollbackCheckpoint: "c" },
        ]),
        plan("generic-shared-contract", [
          { phase: "expand", capabilities: ["dual"], rollbackCheckpoint: "d" },
          { phase: "migrate", capabilities: ["observed"], rollbackCheckpoint: "e" },
          { phase: "contract", capabilities: ["removed"], rollbackCheckpoint: "f" },
        ]),
      ],
    },
    {
      name: "migrate phase 누락",
      changes: ["generic-shared-contract"] as const,
      plans: [
        plan("generic-shared-contract", [
          { phase: "expand", capabilities: ["dual"], rollbackCheckpoint: "a" },
          { phase: "contract", capabilities: ["removed"], rollbackCheckpoint: "c" },
        ]),
      ],
    },
    {
      name: "지원 client가 없는 빈 호환 창",
      changes: ["generic-shared-contract"] as const,
      plans: [
        plan(
          "generic-shared-contract",
          [
            { phase: "expand", capabilities: ["dual"], rollbackCheckpoint: "a" },
            { phase: "migrate", capabilities: ["observed"], rollbackCheckpoint: "b" },
            { phase: "contract", capabilities: ["removed"], rollbackCheckpoint: "c" },
          ],
          { window: { ...window, minimumSupportedClients: {} } },
        ),
      ],
    },
  ])(
    "[T-REL-003][REL-003] $name manifest는 호환 배포를 승인하지 않는다",
    async ({ changes, plans }) => {
      await expect(
        createSubject().verifyCompatibilityWindow({
          releaseId: "release-invalid-generic",
          sharedContractChanges: changes,
          compatibilityPlans: plans,
        }),
      ).resolves.toEqual({ kind: "rejected", code: "INCOMPATIBLE_ORDER" });
    },
  );
});

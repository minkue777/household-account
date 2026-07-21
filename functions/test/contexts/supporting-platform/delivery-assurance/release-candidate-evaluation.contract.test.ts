import { describe, expect, it } from "vitest";

import { createReleaseCandidateEvaluationFixture } from "../../../support/release-candidate-evaluation-fixture";

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
  active: number;
  passed: number;
  failed: number;
  skipped: number;
  knownFailures: number;
}

export interface GateEvidence {
  gate: RequiredReleaseGate;
  status: GateEvidenceStatus;
  testRun?: TestRunSummary;
}

export interface GateWaiver {
  gate: RequiredReleaseGate;
  scope: string;
  reason: string;
  approver: string;
  expiresAt: string;
}

export interface ReleaseCandidateManifest {
  releaseId: string;
  commitSha: string;
  environment: "production";
  firebaseProjectId: "household-account-6f300";
  artifacts: readonly { name: string; sha256: string }[];
  contractVersion: string;
  rulesHash: string;
  indexesHash: string;
  waivers?: readonly GateWaiver[];
}

export interface RejectedGate {
  gate: RequiredReleaseGate;
  code: "GATE_FAILED" | "GATE_MISSING";
  observedStatus: Exclude<GateEvidenceStatus, "passed">;
}

export type ReleaseEvaluation =
  | {
      kind: "approved";
      gateResults: readonly GateEvidence[];
      deployAuthorization: {
        releaseId: string;
        manifestHash: string;
      };
    }
  | {
      kind: "rejected";
      gateResults: readonly GateEvidence[];
      failed: readonly RejectedGate[];
      waivers: readonly GateWaiver[];
    };

/** 각 검증 runner의 의미를 바꾸지 않고 결과를 배포 승인으로 조합하는 공개 계약입니다. */
export interface ReleaseCandidateEvaluationSubject {
  evaluate(manifest: ReleaseCandidateManifest): Promise<ReleaseEvaluation>;
}

export function createSubject(_fixture: {
  gateEvidence: readonly GateEvidence[];
}): ReleaseCandidateEvaluationSubject {
  return createReleaseCandidateEvaluationFixture(_fixture);
}

const requiredGates: readonly RequiredReleaseGate[] = [
  "web-build",
  "functions-build",
  "android-build",
  "active-unit-tests",
  "active-contract-tests",
  "firestore-rules-emulator",
  "requirement-id-trace",
  "relative-link-check",
  "architecture-fitness",
];

const manifest = (
  overrides: Partial<ReleaseCandidateManifest> = {},
): ReleaseCandidateManifest => ({
  releaseId: "release-2026-07-19",
  commitSha: "commit-sha",
  environment: "production",
  firebaseProjectId: "household-account-6f300",
  artifacts: [
    { name: "web", sha256: "web-sha256" },
    { name: "functions", sha256: "functions-sha256" },
    { name: "android", sha256: "android-sha256" },
  ],
  contractVersion: "2.0.0",
  rulesHash: "rules-sha256",
  indexesHash: "indexes-sha256",
  ...overrides,
});

const passingEvidence = (): GateEvidence[] =>
  requiredGates.map((gate) => ({
    gate,
    status: "passed",
    ...(gate === "active-unit-tests" || gate === "active-contract-tests"
      ? {
          testRun: {
            active: 10,
            passed: 10,
            failed: 0,
            skipped: 0,
            knownFailures: 0,
          },
        }
      : {}),
  }));

describe("배포 후보 필수 gate 평가 공개 계약", () => {
  it("[T-REL-001][REL-001] Web·Functions·Android build와 모든 필수 검증이 실제 통과한 후보만 deploy authorization을 받는다", async () => {
    const evidence = passingEvidence();
    const subject = createSubject({ gateEvidence: evidence });

    const result = await subject.evaluate(manifest());

    expect(result).toEqual({
      kind: "approved",
      gateResults: evidence,
      deployAuthorization: {
        releaseId: "release-2026-07-19",
        manifestHash: expect.any(String),
      },
    });
  });

  it.each(requiredGates)(
    "[T-REL-001][REL-001] 필수 gate '%s'의 증거가 없으면 후보를 승인하지 않는다",
    async (missingGate) => {
      const evidence = passingEvidence().filter(
        ({ gate }) => gate !== missingGate,
      );
      const subject = createSubject({ gateEvidence: evidence });

      const result = await subject.evaluate(manifest());

      expect(result.kind).toBe("rejected");
      if (result.kind !== "rejected") return;
      expect(result.failed).toContainEqual({
        gate: missingGate,
        code: "GATE_MISSING",
        observedStatus: "missing",
      });
      expect(result).not.toHaveProperty("deployAuthorization");
    },
  );

  it.each(
    requiredGates.flatMap((gate) =>
      (["failed", "skipped", "known-failure"] as const).map((status) => ({
        gate,
        status,
      })),
    ),
  )(
    "[T-REL-001][REL-001] $gate gate의 $status 상태를 pass로 바꾸지 않는다",
    async ({ gate, status }) => {
      const evidence = passingEvidence().map((item) =>
        item.gate === gate
          ? { ...item, status }
          : item,
      );
      const subject = createSubject({ gateEvidence: evidence });

      const result = await subject.evaluate(manifest());

      expect(result.kind).toBe("rejected");
      if (result.kind !== "rejected") return;
      expect(result.failed).toContainEqual({
        gate,
        code: "GATE_FAILED",
        observedStatus: status,
      });
      expect(result).not.toHaveProperty("deployAuthorization");
    },
  );

  it.each([
    {
      name: "실패한 active test",
      summary: {
        active: 10,
        passed: 9,
        failed: 1,
        skipped: 0,
        knownFailures: 0,
      },
    },
    {
      name: "skip으로 제외한 test",
      summary: {
        active: 9,
        passed: 9,
        failed: 0,
        skipped: 1,
        knownFailures: 0,
      },
    },
    {
      name: "known failure로 제외한 test",
      summary: {
        active: 9,
        passed: 9,
        failed: 0,
        skipped: 0,
        knownFailures: 1,
      },
    },
  ])(
    "[T-REL-001][REL-001] runner가 gate를 passed로 표시해도 $name을 성공으로 오판하지 않는다",
    async ({ summary }) => {
      const evidence = passingEvidence().map((item) =>
        item.gate === "active-contract-tests"
          ? { ...item, status: "passed" as const, testRun: summary }
          : item,
      );
      const subject = createSubject({ gateEvidence: evidence });

      const result = await subject.evaluate(manifest());

      expect(result.kind).toBe("rejected");
      if (result.kind !== "rejected") return;
      expect(result.failed).toContainEqual({
        gate: "active-contract-tests",
        code: "GATE_FAILED",
        observedStatus: "failed",
      });
      expect(result).not.toHaveProperty("deployAuthorization");
    },
  );

  it.each([
    ["test summary 누락", undefined],
    [
      "active·passed 수 불일치",
      { active: 10, passed: 9, failed: 0, skipped: 0, knownFailures: 0 },
    ],
  ] as const)(
    "[T-REL-001][REL-001] passed test gate도 %s이면 실패로 판정한다",
    async (_label, testRun) => {
      const evidence = passingEvidence().map((item) =>
        item.gate === "active-contract-tests"
          ? { gate: item.gate, status: "passed" as const, testRun }
          : item,
      );

      const result = await createSubject({ gateEvidence: evidence }).evaluate(manifest());

      expect(result).toMatchObject({
        kind: "rejected",
        failed: [
          expect.objectContaining({
            gate: "active-contract-tests",
            code: "GATE_FAILED",
            observedStatus: "failed",
          }),
        ],
      });
    },
  );

  it("[T-REL-001][REL-001][DEC-064] waiver가 있어도 누락된 gate를 대신하지 않는다", async () => {
    const waiver: GateWaiver = {
      gate: "architecture-fitness",
      scope: "temporary",
      reason: "pending",
      approver: "operations-admin",
      expiresAt: "2026-07-20T00:00:00.000Z",
    };
    const evidence = passingEvidence().filter(({ gate }) => gate !== waiver.gate);

    const result = await createSubject({ gateEvidence: evidence }).evaluate(
      manifest({ waivers: [waiver] }),
    );

    expect(result).toMatchObject({
      kind: "rejected",
      waivers: [waiver],
      failed: [
        expect.objectContaining({ gate: waiver.gate, code: "GATE_MISSING" }),
      ],
    });
  });

  it("[T-REL-001][REL-001][DEC-064] 긴급 waiver는 실패를 pass로 바꾸거나 deploy authorization을 만들지 않고 별도 근거로만 보존한다", async () => {
    const waiver: GateWaiver = {
      gate: "relative-link-check",
      scope: "docs/legacy",
      reason: "이전 문서의 링크 복구 대기",
      approver: "operations-admin",
      expiresAt: "2026-07-20T00:00:00.000Z",
    };
    const evidence = passingEvidence().map((item) =>
      item.gate === waiver.gate
        ? { ...item, status: "failed" as const }
        : item,
    );
    const subject = createSubject({ gateEvidence: evidence });

    const result = await subject.evaluate(manifest({ waivers: [waiver] }));

    expect(result.kind).toBe("rejected");
    if (result.kind !== "rejected") return;
    expect(result.waivers).toEqual([waiver]);
    expect(result.failed).toContainEqual({
      gate: "relative-link-check",
      code: "GATE_FAILED",
      observedStatus: "failed",
    });
    expect(result).not.toHaveProperty("deployAuthorization");
  });
});

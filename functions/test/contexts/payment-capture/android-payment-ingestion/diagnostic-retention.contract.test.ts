import { describe, expect, it } from "vitest";
import { createDiagnosticRetentionDriver } from "../../../support/diagnostic-retention-driver";

export interface DiagnosticActorFixture {
  householdId: string;
  memberId: string;
  role: "member" | "administrator" | "diagnostic-reader";
}

export interface DiagnosticNotificationFixture {
  packageName: string;
  sourceType: string;
  title: string;
  text: string;
  bigText: string;
  textLines: readonly string[];
  fullText: string;
  postedAtMillis: number;
  collectedAt: string;
}

export type DiagnosticCollectionResult =
  | { kind: "Collected"; diagnosticId: string; businessOutcome: "Accepted" | "Ignored" }
  | {
      kind: "Skipped";
      reason: "ACTOR_REQUIRED" | "SOURCE_NOT_REGISTERED";
      businessOutcome: "Accepted" | "Ignored";
    }
  | {
      kind: "BestEffortFailure";
      code: "DIAGNOSTIC_WRITE_FAILED";
      businessOutcome: "Accepted" | "Ignored";
    };

export type DiagnosticReadResult =
  | { kind: "Allowed"; documents: readonly DiagnosticDocumentView[] }
  | { kind: "Forbidden" };

export interface DiagnosticDocumentView extends DiagnosticNotificationFixture {
  diagnosticId: string;
  householdId: string;
  memberId: string;
}

export interface DiagnosticRetentionState {
  documents: readonly DiagnosticDocumentView[];
}

export interface DiagnosticRetentionContractSubject {
  collect(input: {
    actor?: DiagnosticActorFixture;
    sourceRegistered: boolean;
    notification: DiagnosticNotificationFixture;
    businessOutcome: "Accepted" | "Ignored";
    storageOutcome?: "success" | "failure";
    unrelatedSecrets?: {
      authToken: string;
      fcmFid: string;
      householdAccessKey: string;
    };
  }): Promise<DiagnosticCollectionResult>;
  readAll(actor: DiagnosticActorFixture): Promise<DiagnosticReadResult>;
  state(at: string): Promise<DiagnosticRetentionState>;
}

export function createSubject(): DiagnosticRetentionContractSubject {
  return createDiagnosticRetentionDriver();
}

const notification = (
  suffix = "1",
): DiagnosticNotificationFixture => ({
  packageName: "com.example.card",
  sourceType: "example-card",
  title: `승인 ${suffix}`,
  text: `본문 ${suffix}`,
  bigText: `확장 본문 ${suffix}`,
  textLines: [`첫 행 ${suffix}`, `둘째 행 ${suffix}`],
  fullText: `승인 ${suffix}\n본문 ${suffix}`,
  postedAtMillis: 1_768_879_800_000,
  collectedAt: "2026-07-20T10:00:00+09:00",
});

const member = (role: DiagnosticActorFixture["role"] = "member"): DiagnosticActorFixture => ({
  householdId: "household-1",
  memberId: "member-1",
  role,
});

describe("임시 알림 원문 진단 Adapter 공개 계약", () => {
  it.each([
    { name: "actor 없음", actor: undefined, sourceRegistered: true, reason: "ACTOR_REQUIRED" },
    {
      name: "household 식별자 없음",
      actor: { ...member(), householdId: "   " },
      sourceRegistered: true,
      reason: "ACTOR_REQUIRED",
    },
    {
      name: "member 식별자 없음",
      actor: { ...member(), memberId: "" },
      sourceRegistered: true,
      reason: "ACTOR_REQUIRED",
    },
    {
      name: "미등록 source",
      actor: member(),
      sourceRegistered: false,
      reason: "SOURCE_NOT_REGISTERED",
    },
  ] as const)(
    "[T-DIAG-001][ING-005] $name 입력은 진단 문서를 만들지 않는다",
    async ({ actor, sourceRegistered, reason }) => {
      const subject = createSubject();

      expect(
        await subject.collect({
          actor,
          sourceRegistered,
          notification: notification(),
          businessOutcome: "Accepted",
        }),
      ).toEqual({
        kind: "Skipped",
        reason,
        businessOutcome: "Accepted",
      });
      expect((await subject.state("2036-07-20T10:00:00+09:00")).documents).toEqual([]);
    },
  );

  it("[T-DIAG-001][ING-005][DEC-047] 동일 원문도 dedupe하지 않고 기능 제거 전까지 시간 TTL 없이 모두 보존한다", async () => {
    const subject = createSubject();
    const input = {
      actor: member(),
      sourceRegistered: true,
      notification: notification(),
      businessOutcome: "Accepted" as const,
    };

    expect((await subject.collect(input)).kind).toBe("Collected");
    expect((await subject.collect(input)).kind).toBe("Collected");

    const state = await subject.state("2036-07-20T10:00:00+09:00");
    expect(state.documents).toHaveLength(2);
    expect(state.documents[0]).toMatchObject(notification());
    expect(state.documents[1]).toMatchObject(notification());
    expect(state.documents[0].diagnosticId).not.toBe(state.documents[1].diagnosticId);
  });

  it.each(["Accepted", "Ignored"] as const)(
    "[T-DIAG-001][ING-005] 진단 저장 실패는 $s 업무 결과를 바꾸지 않는다",
    async (businessOutcome) => {
      const subject = createSubject();

      const result = await subject.collect({
        actor: member(),
        sourceRegistered: true,
        notification: notification(),
        businessOutcome,
        storageOutcome: "failure",
      });

      expect(result).toEqual({
        kind: "BestEffortFailure",
        code: "DIAGNOSTIC_WRITE_FAILED",
        businessOutcome,
      });
      expect((await subject.state("2026-07-20T10:01:00+09:00")).documents).toEqual([]);
    },
  );

  it("[T-DIAG-001][ING-005][DEC-047] 저장 문서는 허용된 원문 필드·actor scope·수집 시각만 정확히 보존한다", async () => {
    const subject = createSubject();
    const result = await subject.collect({
      actor: member(),
      sourceRegistered: true,
      notification: notification("allowed"),
      businessOutcome: "Ignored",
    });
    if (result.kind !== "Collected") throw new Error("진단 문서가 필요합니다.");

    expect((await subject.state("2036-07-20T10:00:00+09:00")).documents).toEqual([
      {
        diagnosticId: result.diagnosticId,
        householdId: "household-1",
        memberId: "member-1",
        ...notification("allowed"),
      },
    ]);
  });

  it("[T-DIAG-001][ING-005] 별도 인증·전달 Secret은 진단 문서에 추가하지 않는다", async () => {
    const subject = createSubject();
    await subject.collect({
      actor: member(),
      sourceRegistered: true,
      notification: notification(),
      businessOutcome: "Accepted",
      unrelatedSecrets: {
        authToken: "secret-auth-token",
        fcmFid: "secret-fid",
        householdAccessKey: "secret-household-key",
      },
    });

    const [document] = (await subject.state("2026-07-20T10:01:00+09:00")).documents;
    expect(document).not.toHaveProperty("authToken");
    expect(document).not.toHaveProperty("fcmFid");
    expect(document).not.toHaveProperty("householdAccessKey");
  });

  it("[T-DIAG-001][ING-005] 일반 멤버는 원문을 읽을 수 없고 관리자·진단 역할만 읽는다", async () => {
    const subject = createSubject();
    await subject.collect({
      actor: member(),
      sourceRegistered: true,
      notification: notification(),
      businessOutcome: "Ignored",
    });

    expect(await subject.readAll(member("member"))).toEqual({ kind: "Forbidden" });
    expect(await subject.readAll(member("administrator"))).toMatchObject({
      kind: "Allowed",
      documents: [expect.objectContaining(notification())],
    });
    expect(await subject.readAll(member("diagnostic-reader"))).toMatchObject({
      kind: "Allowed",
      documents: [expect.objectContaining(notification())],
    });
    expect((await subject.state("2036-07-20T10:00:00+09:00")).documents).toHaveLength(1);
  });
});

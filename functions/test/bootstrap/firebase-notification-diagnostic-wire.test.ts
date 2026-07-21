import { describe, expect, it } from "vitest";

import type { CaptureMembershipResolver } from "../../src/adapters/firebase/payment-capture/firebaseCaptureMembershipResolver";
import {
  NotificationDiagnosticCallableRejection,
  createNotificationDiagnosticCallableHandler,
} from "../../src/bootstrap/firebaseNotificationDiagnostic";
import type {
  DiagnosticCollectionResult,
  DiagnosticRetentionInputPort,
} from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/in/diagnosticRetentionInputPort";
import { resolveRegisteredDiagnosticSource } from "../../src/contexts/payment-capture/android-payment-ingestion/domain/policies/resolveDiagnosticSource";

function activeMembership(): CaptureMembershipResolver {
  return {
    resolve: async (principalUid) =>
      principalUid === undefined
        ? { kind: "unauthenticated", code: "AUTH_REQUIRED" }
        : {
            kind: "active",
            principalUid,
            householdId: "server-household",
            memberId: "server-member",
          },
  };
}

function payload(packageName = "com.kbcard.cxh.appcard") {
  return {
    packageName,
    title: "승인",
    text: "12,000원",
    bigText: "KB국민카드 12,000원 승인",
    textLines: ["KB국민카드", "12,000원 승인"],
    fullText: "승인\nKB국민카드 12,000원 승인",
    postedAtMillis: 1_768_879_800_000,
  };
}

function recordingDiagnostics(
  record: Array<Parameters<DiagnosticRetentionInputPort["collect"]>[0]>,
): DiagnosticRetentionInputPort {
  return {
    collect: async (input): Promise<DiagnosticCollectionResult> => {
      record.push(input);
      return input.sourceRegistered
        ? {
            kind: "Collected",
            diagnosticId: "diagnostic-1",
            businessOutcome: input.businessOutcome,
          }
        : {
            kind: "Skipped",
            reason: "SOURCE_NOT_REGISTERED",
            businessOutcome: input.businessOutcome,
          };
    },
    readAll: async () => ({ kind: "Forbidden" }),
  };
}

describe("submitNotificationDiagnostic callable wire", () => {
  it("인증 UID의 활성 membership과 서버 source registry로 actor와 source를 확정한다", async () => {
    const collected: Array<Parameters<DiagnosticRetentionInputPort["collect"]>[0]> = [];
    const handler = createNotificationDiagnosticCallableHandler({
      memberships: activeMembership(),
      diagnostics: recordingDiagnostics(collected),
      now: () => "2026-07-21T01:02:03.000Z",
    });

    await expect(
      handler.handle({ principalUid: "firebase-uid", data: payload() }),
    ).resolves.toEqual({
      contractVersion: "notification-diagnostic-response.v1",
      result: {
        kind: "Collected",
        diagnosticId: "diagnostic-1",
        businessOutcome: "Ignored",
      },
    });
    expect(collected).toEqual([
      expect.objectContaining({
        actor: {
          householdId: "server-household",
          memberId: "server-member",
          role: "member",
        },
        sourceRegistered: true,
        notification: expect.objectContaining({
          packageName: "com.kbcard.cxh.appcard",
          sourceType: "kb-card",
          postedAtMillis: 1_768_879_800_000,
          collectedAt: "2026-07-21T01:02:03.000Z",
        }),
      }),
    ]);
  });

  it("인증 전에는 payload를 해석하지 않고, actor나 source를 주장하는 필드는 거부한다", async () => {
    let decoded = false;
    const handler = createNotificationDiagnosticCallableHandler({
      memberships: activeMembership(),
      diagnostics: recordingDiagnostics([]),
      decode: () => {
        decoded = true;
        return payload();
      },
    });
    await expect(handler.handle({ data: {} })).rejects.toMatchObject({
      callableCode: "unauthenticated",
      domainCode: "AUTH_REQUIRED",
    });
    expect(decoded).toBe(false);

    const strict = createNotificationDiagnosticCallableHandler({
      memberships: activeMembership(),
      diagnostics: recordingDiagnostics([]),
    });
    await expect(
      strict.handle({
        principalUid: "firebase-uid",
        data: { ...payload(), householdId: "client-household" },
      }),
    ).rejects.toMatchObject({
      callableCode: "invalid-argument",
      domainCode: "UNKNOWN_FIELD",
      details: { path: "$.householdId" },
    });
  });

  it("미등록 package는 저장 대상으로 승격하지 않는다", async () => {
    const collected: Array<Parameters<DiagnosticRetentionInputPort["collect"]>[0]> = [];
    const handler = createNotificationDiagnosticCallableHandler({
      memberships: activeMembership(),
      diagnostics: recordingDiagnostics(collected),
    });
    const response = await handler.handle({
      principalUid: "firebase-uid",
      data: payload("com.example.unregistered"),
    });

    expect(response.result).toMatchObject({
      kind: "Skipped",
      reason: "SOURCE_NOT_REGISTERED",
    });
    expect(collected[0]).toMatchObject({ sourceRegistered: false });
  });

  it("진단 전용 package는 허용하되 Toss 걷기와 일반 카카오톡은 제외한다", () => {
    expect(
      resolveRegisteredDiagnosticSource(payload("com.hyundaicard.appcard")),
    ).toEqual({
      packageName: "com.hyundaicard.appcard",
      sourceType: "HYUNDAI_CARD",
    });
    expect(
      resolveRegisteredDiagnosticSource({
        ...payload("viva.republica.toss"),
        title: "12,345 걸음",
      }),
    ).toBeUndefined();
    expect(
      resolveRegisteredDiagnosticSource({
        ...payload("com.kakao.talk"),
        fullText: "친구와 나눈 일반 대화",
      }),
    ).toBeUndefined();
    expect(
      resolveRegisteredDiagnosticSource({
        ...payload("com.kakao.talk"),
        fullText: "도시가스 요금 청구 안내",
      }),
    ).toEqual({
      packageName: "com.kakao.talk",
      sourceType: "city-gas-bill",
    });
  });

  it("validation 오류는 callable invalid-argument로 보존한다", async () => {
    const handler = createNotificationDiagnosticCallableHandler({
      memberships: activeMembership(),
      diagnostics: recordingDiagnostics([]),
    });
    await expect(
      handler.handle({
        principalUid: "firebase-uid",
        data: { ...payload(), postedAtMillis: -1 },
      }),
    ).rejects.toBeInstanceOf(NotificationDiagnosticCallableRejection);
    await expect(
      handler.handle({
        principalUid: "firebase-uid",
        data: { ...payload(), postedAtMillis: -1 },
      }),
    ).rejects.toMatchObject({
      callableCode: "invalid-argument",
      domainCode: "POSTED_AT_INVALID",
      details: { path: "$.postedAtMillis" },
    });
  });
});

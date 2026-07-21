import { describe, expect, it } from "vitest";

import type { CaptureMembershipResolver } from "../../src/adapters/firebase/payment-capture/firebaseCaptureMembershipResolver";
import {
  CaptureCallableRejection,
  createCaptureSubmissionCallableHandler,
} from "../../src/bootstrap/firebaseCaptureSubmission";
import type {
  CaptureSubmissionCommand,
  CaptureSubmissionInputPort,
  CaptureSubmissionOutcome,
} from "../../src/contexts/payment-capture/android-payment-ingestion/application/ports/in/captureSubmissionInputPort";

function envelope(packageName = "com.kbcard.cxh.appcard") {
  return {
    contractVersion: "capture-envelope.v1",
    observationId: "observation-wire-1",
    originChannel: "android-notification",
    sourceEvidence: {
      kind: "android-registered-package",
      sourceType: "kb-card",
      packageName,
      registryVersion: "source-registry.v1",
    },
    observedAt: "2026-07-21T10:05:01+09:00",
    parser: { parserId: "kb-card-parser", parserVersion: "2.0.0" },
    rawPayloadHash:
      "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    paymentObservation: {
      branchId: "payment-wire-1",
      observationType: "approval",
      amountInWon: 12_000,
      occurredLocalDate: "2026-07-21",
      occurredLocalTime: "10:05",
      zoneId: "Asia/Seoul",
      merchantEvidence: { rawCandidate: "가맹점 A" },
      cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
    },
  };
}

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

describe("submitCaptureEnvelope callable wire", () => {
  it("wire가 아니라 인증 UID의 활성 membership으로 household·creator를 확정한다", async () => {
    let captured: CaptureSubmissionCommand | undefined;
    const submissions: CaptureSubmissionInputPort = {
      submit: async (command) => {
        captured = command;
        return {
          kind: "success",
          value: {
            observationId: command.envelope.observationId,
            transactionResult: {
              kind: "created",
              transactionId: "transaction-1",
              editable: true,
              captureLineageId: "lineage-1",
              aggregateVersion: 1,
            },
            completion: "terminal",
          },
        };
      },
    };
    const handler = createCaptureSubmissionCallableHandler({
      memberships: activeMembership(),
      submissions,
    });

    const response = await handler.handle({
      principalUid: "firebase-uid",
      data: envelope(),
    });

    expect(captured).toMatchObject({
      rootIdempotencyKey: "observation-wire-1",
      actor: {
        principalId: "firebase-uid",
        householdId: "server-household",
        actingMemberId: "server-member",
        capabilities: ["paymentCapture:submit"],
      },
    });
    expect(response).toEqual({
      contractVersion: "capture-submission-response.v1",
      result: {
        observationId: "observation-wire-1",
        transactionResult: {
          kind: "created",
          transactionId: "transaction-1",
          editable: true,
          captureLineageId: "lineage-1",
          aggregateVersion: 1,
        },
        completion: "terminal",
      },
    });
  });

  it("미인증 요청은 payload를 해석하기 전에 거부한다", async () => {
    let decoded = false;
    const handler = createCaptureSubmissionCallableHandler({
      memberships: activeMembership(),
      submissions: {
        submit: async (): Promise<CaptureSubmissionOutcome> => {
          throw new Error("호출되면 안 됩니다.");
        },
      },
      decode: () => {
        decoded = true;
        throw new Error("호출되면 안 됩니다.");
      },
    });

    await expect(handler.handle({ data: {} })).rejects.toBeInstanceOf(
      CaptureCallableRejection,
    );
    await expect(handler.handle({ data: {} })).rejects.toMatchObject({
      callableCode: "unauthenticated",
      domainCode: "AUTH_REQUIRED",
    });
    expect(decoded).toBe(false);
  });

  it("미등록 package는 거래 저장소를 호출하지 않고 terminal rejected receipt로 응답한다", async () => {
    let attempts = 0;
    const handler = createCaptureSubmissionCallableHandler({
      memberships: activeMembership(),
      submissions: {
        submit: async () => {
          attempts += 1;
          throw new Error("호출되면 안 됩니다.");
        },
      },
    });

    expect(
      await handler.handle({
        principalUid: "firebase-uid",
        data: envelope("com.example.unregistered"),
      }),
    ).toEqual({
      contractVersion: "capture-submission-response.v1",
      result: {
        observationId: "observation-wire-1",
        transactionResult: { kind: "rejected", code: "UNSUPPORTED_SOURCE" },
        completion: "terminal",
      },
    });
    expect(attempts).toBe(0);
  });

  it("strict decoder 오류와 root payload 충돌을 callable error로 구분한다", async () => {
    const invalidHandler = createCaptureSubmissionCallableHandler({
      memberships: activeMembership(),
      submissions: {
        submit: async (): Promise<CaptureSubmissionOutcome> => {
          throw new Error("호출되면 안 됩니다.");
        },
      },
    });
    await expect(
      invalidHandler.handle({
        principalUid: "firebase-uid",
        data: { ...envelope(), householdId: "wire-household" },
      }),
    ).rejects.toMatchObject({
      callableCode: "invalid-argument",
      domainCode: "UNKNOWN_FIELD",
      details: { path: "$.householdId" },
    });

    const conflictHandler = createCaptureSubmissionCallableHandler({
      memberships: activeMembership(),
      submissions: {
        submit: async () => ({
          kind: "conflict",
          code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
        }),
      },
    });
    await expect(
      conflictHandler.handle({
        principalUid: "firebase-uid",
        data: envelope(),
      }),
    ).rejects.toMatchObject({
      callableCode: "already-exists",
      domainCode: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
  });
});

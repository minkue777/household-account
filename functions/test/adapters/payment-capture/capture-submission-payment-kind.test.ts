import { describe, expect, it } from "vitest";

import { createTenantAuthorizationApplication } from "../../../src/contexts/access/tenant-authorization/application/tenantAuthorizationApplication";
import { createCaptureSubmissionApplication } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/captureSubmissionApplication";
import type { CaptureBranchEnvelope } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/in/captureBranchSubmissionInputPort";
import type { CaptureEnvelopeInput } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/in/captureSubmissionInputPort";

function envelope(
  observationId: string,
  paymentKind: "card" | "bill",
): CaptureEnvelopeInput {
  const bill = paymentKind === "bill";
  return {
    contractVersion: "capture-envelope.v1",
    observationId,
    originChannel: "android-notification",
    sourceEvidence: {
      kind: "android-registered-package",
      sourceType: "kakao-talk-financial-message",
      packageName: "com.kakao.talk",
      registryVersion: "source-registry.v1",
    },
    observedAt: "2026-08-08T14:49:00+09:00",
    parser: {
      parserId: "kakao-talk-financial-message-parser",
      parserVersion: "1.0.0",
    },
    rawPayloadHash: `sha256:${"1".repeat(64)}`,
    paymentObservation: {
      branchId: `branch.${observationId}.payment`,
      observationType: "approval",
      amountInWon: 78_120,
      occurredLocalDate: bill ? "2026-08-15" : "2026-08-08",
      occurredLocalTime: "13:33",
      zoneId: "Asia/Seoul",
      merchantEvidence: {
        rawCandidate: bill ? "8월 도시가스요금" : "신세계사우스시티",
      },
      ...(bill
        ? { dueDate: "2026-08-15" }
        : {
            cardEvidence: { companyLabel: "삼성", maskedToken: "8481" },
          }),
    },
  };
}

function subject() {
  const captured: CaptureBranchEnvelope[] = [];
  const application = createCaptureSubmissionApplication({
    tenantAuthorization: createTenantAuthorizationApplication({
      memberships: { findByPrincipalUid: async () => undefined },
    }),
    branches: {
      submit: async (branchEnvelope) => {
        captured.push(branchEnvelope);
        return {
          kind: "accepted" as const,
          completion: "terminal" as const,
          transactionResult: {
            kind: "rejected" as const,
            code: "TEST_TERMINAL",
          },
        };
      },
    },
  });
  return { application, captured };
}

const actor = {
  principalId: "firebase-uid",
  householdId: "household-1",
  actingMemberId: "member-1",
  capabilities: ["paymentCapture:submit" as const],
};

describe("Capture submission 내부 payment kind 전달", () => {
  it.each(["card", "bill"] as const)(
    "%s 판정을 transaction branch captureContext에 보존한다",
    async (paymentKind) => {
      const { application, captured } = subject();
      const captureEnvelope = envelope(
        `observation-kakao-${paymentKind}`,
        paymentKind,
      );

      await application.submit({
        actor,
        rootIdempotencyKey: captureEnvelope.observationId,
        envelope: captureEnvelope,
        paymentKind,
      });

      expect(captured).toHaveLength(1);
      expect(captured[0].transactionBranch?.captureContext).toMatchObject({
        paymentKind,
        ...(paymentKind === "bill" ? { billDueDate: "2026-08-15" } : {}),
      });
    },
  );

  it("카카오가 아닌 source의 bill 주장은 branch 호출 전에 거부한다", async () => {
    const { application, captured } = subject();
    const base = envelope("observation-kb-forged-bill", "bill");
    const captureEnvelope: CaptureEnvelopeInput = {
      ...base,
      sourceEvidence: {
        kind: "android-registered-package",
        sourceType: "kb-card",
        packageName: "com.kbcard.cxh.appcard",
        registryVersion: "source-registry.v1",
      },
      parser: { parserId: "kb-card-parser", parserVersion: "2.0.0" },
    };

    await expect(
      application.submit({
        actor,
        rootIdempotencyKey: captureEnvelope.observationId,
        envelope: captureEnvelope,
        paymentKind: "bill",
      }),
    ).resolves.toEqual({
      kind: "success",
      value: {
        observationId: captureEnvelope.observationId,
        transactionResult: {
          kind: "rejected",
          code: "PAYMENT_KIND_EVIDENCE_MISMATCH",
        },
        completion: "terminal",
      },
    });
    expect(captured).toEqual([]);
  });

  it("카드 증거와 bill 주장이 섞인 입력은 branch 호출 전에 거부한다", async () => {
    const { application, captured } = subject();
    const base = envelope("observation-kakao-mixed-bill-card", "bill");
    const captureEnvelope: CaptureEnvelopeInput = {
      ...base,
      paymentObservation: {
        ...base.paymentObservation!,
        cardEvidence: { companyLabel: "삼성", maskedToken: "8481" },
      },
    };

    const result = await application.submit({
      actor,
      rootIdempotencyKey: captureEnvelope.observationId,
      envelope: captureEnvelope,
      paymentKind: "bill",
    });

    expect(result).toMatchObject({
      kind: "success",
      value: {
        transactionResult: {
          kind: "rejected",
          code: "PAYMENT_KIND_EVIDENCE_MISMATCH",
        },
        completion: "terminal",
      },
    });
    expect(captured).toEqual([]);
  });

  it("취소 관찰의 bill 주장은 branch 호출 전에 거부한다", async () => {
    const { application, captured } = subject();
    const base = envelope("observation-kakao-cancellation-bill", "bill");
    const captureEnvelope: CaptureEnvelopeInput = {
      ...base,
      paymentObservation: {
        ...base.paymentObservation!,
        observationType: "cancellation",
      },
    };

    const result = await application.submit({
      actor,
      rootIdempotencyKey: captureEnvelope.observationId,
      envelope: captureEnvelope,
      paymentKind: "bill",
    });

    expect(result).toMatchObject({
      kind: "success",
      value: {
        transactionResult: {
          kind: "rejected",
          code: "PAYMENT_KIND_EVIDENCE_MISMATCH",
        },
        completion: "terminal",
      },
    });
    expect(captured).toEqual([]);
  });
});

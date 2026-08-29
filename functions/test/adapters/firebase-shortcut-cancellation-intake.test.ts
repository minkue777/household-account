import { describe, expect, it } from "vitest";

import { FirebaseShortcutCaptureIntakeAdapter } from "../../src/adapters/firebase/payment-capture/firebaseShortcutHttpInfrastructure";
import type {
  CaptureSubmissionCommand,
  CaptureSubmissionInputPort,
  CaptureSubmittedTransactionResult,
} from "../../src/contexts/payment-capture/android-payment-ingestion/public";
import type {
  ShortcutCardMessageParseResult,
  ShortcutHttpPaymentIntakeResult,
} from "../../src/contexts/payment-capture/shortcut-ingestion/public";

type ParsedShortcutPayment = Extract<
  ShortcutCardMessageParseResult,
  { kind: "Parsed" }
>;

function parsedPayment(
  observationType: "approval" | "cancellation",
): ParsedShortcutPayment {
  return {
    kind: "Parsed",
    observationType,
    amountInWon: 140_000,
    occurredLocalDate: "2026-08-12",
    occurredLocalTime: "17:53",
    merchant: "덕양주유소",
    cardEvidence: { companyLabel: "농협", maskedToken: "4x3x" },
  };
}

async function submitThroughAdapter(
  transactionResult: CaptureSubmittedTransactionResult,
  observationType: "approval" | "cancellation" = "cancellation",
): Promise<{
  readonly captured: CaptureSubmissionCommand;
  readonly result: ShortcutHttpPaymentIntakeResult;
}> {
  let captured: CaptureSubmissionCommand | undefined;
  const subject = new FirebaseShortcutCaptureIntakeAdapter({
    async submit(command) {
      captured = command;
      return {
        kind: "success",
        value: {
          observationId: command.envelope.observationId,
          transactionResult,
          completion: "terminal",
        },
      };
    },
  });
  const result = await subject.submit({
    commandId: `shortcut-command-${observationType}-fixture`,
    credentialId: "credential-fixture",
    payloadHash: "payload-hash-fixture",
    requestedAt: "2026-08-12T17:53:09+09:00",
    actor: {
      principalUid: "principal-fixture",
      householdId: "household-fixture",
      actingMemberId: "member-fixture",
      capabilities: ["paymentCapture:submit"],
    },
    parsed: parsedPayment(observationType),
  });
  if (captured === undefined) throw new Error("Capture submission 없음");
  return { captured, result };
}

describe("Firebase iOS Shortcut cancellation intake adapter", () => {
  it("[T-IOS-CANCEL-001][T-PARSE-004][T-CAN-003][IOS-003][IOS-015] parser의 cancellation 판정을 capture envelope에 보존한다", async () => {
    let captured: CaptureSubmissionCommand | undefined;
    const submissions: CaptureSubmissionInputPort = {
      async submit(command) {
        captured = command;
        return {
          kind: "success",
          value: {
            observationId: command.envelope.observationId,
            transactionResult: {
              kind: "cancelled",
              transactionIds: ["transaction-fixture"],
            },
            completion: "terminal",
          },
        };
      },
    };
    const subject = new FirebaseShortcutCaptureIntakeAdapter(submissions);
    const parsedCancellation = {
      kind: "Parsed" as const,
      observationType: "cancellation" as const,
      amountInWon: 140_000,
      occurredLocalDate: "2026-08-12",
      occurredLocalTime: "17:53",
      merchant: "덕양주유소",
      cardEvidence: {
        companyLabel: "농협",
        maskedToken: "4x3x",
      },
    };

    const result = await subject.submit({
      commandId: "shortcut-command-cancellation-fixture",
      credentialId: "credential-fixture",
      payloadHash: "payload-hash-fixture",
      requestedAt: "2026-08-12T17:53:09+09:00",
      actor: {
        principalUid: "principal-fixture",
        householdId: "household-fixture",
        actingMemberId: "member-fixture",
        capabilities: ["paymentCapture:submit"],
      },
      parsed: parsedCancellation,
    });

    expect(captured?.envelope.paymentObservation).toMatchObject({
      observationType: "cancellation",
      amountInWon: 140_000,
      occurredLocalDate: "2026-08-12",
      occurredLocalTime: "17:53",
      merchantEvidence: { rawCandidate: "덕양주유소" },
      cardEvidence: { companyLabel: "농협", maskedToken: "4x3x" },
    });
    expect(result).toEqual({
      kind: "cancelled",
      transactionIds: ["transaction-fixture"],
    });
  });

  it("[T-PARSE-004][IOS-003] approval 판정도 capture envelope에 그대로 보존한다", async () => {
    const { captured, result } = await submitThroughAdapter(
      {
        kind: "created",
        transactionId: "transaction-created",
        editable: true,
        captureLineageId: "capture-lineage-created",
        aggregateVersion: 1,
      },
      "approval",
    );

    expect(captured.envelope.paymentObservation?.observationType).toBe(
      "approval",
    );
    expect(result).toEqual({
      kind: "created",
      transactionId: "transaction-created",
    });
  });

  it.each([
    {
      name: "복수 lineage",
      transactionResult: {
        kind: "needsConfirmation",
        captureLineageIds: ["capture-lineage-a", "capture-lineage-b"],
      } as const,
      expected: {
        kind: "needs-confirmation",
        captureLineageIds: ["capture-lineage-a", "capture-lineage-b"],
      } as const,
    },
    {
      name: "취소 원거래 없음",
      transactionResult: {
        kind: "notFound",
        resource: "cancellationTarget",
      } as const,
      expected: { kind: "cancellation-not-found" } as const,
    },
    {
      name: "공통 Intake 일시 실패",
      transactionResult: {
        kind: "retryableFailure",
        code: "LEDGER_UNAVAILABLE",
      } as const,
      expected: { kind: "retryable-failure" } as const,
    },
    {
      name: "본인 등록 카드 불일치",
      transactionResult: {
        kind: "rejected",
        code: "CARD_NOT_REGISTERED_FOR_ACTOR",
      } as const,
      expected: {
        kind: "rejected",
        code: "CARD_NOT_REGISTERED_FOR_ACTOR",
      } as const,
    },
  ])(
    "[T-IOS-CANCEL-001][IOS-015] $name Capture 결과를 Shortcut intake 결과로 매핑한다",
    async ({ transactionResult, expected }) => {
      const { result } = await submitThroughAdapter(transactionResult);

      expect(result).toEqual(expected);
    },
  );
});

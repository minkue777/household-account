import { describe, expect, it } from "vitest";

import { createShortcutHttpRequestProcessorApplication } from "../../src/contexts/payment-capture/shortcut-ingestion/application/shortcutHttpRequestProcessorApplication";
import type { ShortcutHttpPaymentIntakeResult } from "../../src/contexts/payment-capture/shortcut-ingestion/public";

function cancellationProcessor(intakeResult: ShortcutHttpPaymentIntakeResult) {
  return createShortcutHttpRequestProcessorApplication({
    credentials: {
      async authorize() {
        return {
          kind: "authorized",
          credential: {
            credentialId: "credential-janghwi",
            actor: {
              principalUid: "uid-janghwi",
              householdId: "household-janghwi-minji",
              actingMemberId: "member-janghwi",
              capabilities: ["paymentCapture:submit"],
            },
          },
        } as const;
      },
    },
    credentialGate: {
      async evaluate() {
        return { kind: "allowed" } as const;
      },
    },
    parser: {
      parse() {
        return {
          kind: "Parsed",
          observationType: "cancellation",
          amountInWon: 140_000,
          occurredLocalDate: "2026-08-12",
          occurredLocalTime: "17:53",
          merchant: "덕양주유소",
          cardEvidence: { companyLabel: "농협", maskedToken: "4x3x" },
        } as const;
      },
    },
    intake: {
      async submit() {
        return intakeResult;
      },
    },
    receipts: {
      async claim() {
        return { kind: "claimed" } as const;
      },
      async complete() {},
      async abandon() {},
      async waitForCompletion() {
        throw new Error("unexpected receipt wait");
      },
    },
    hashes: {
      hash(value) {
        return `0123456789abcdef01234567:${value}`;
      },
    },
  });
}

describe("iPhone Shortcut cancellation HTTP result", () => {
  it("취소 성공은 삭제된 거래 ID를 반환하고 편집 알림을 요청하지 않는다", async () => {
    const result = await cancellationProcessor({
      kind: "cancelled",
      transactionIds: ["transaction-preauthorization"],
    }).process({
      bearerCredential: "raw-credential",
      diagnosticRawMessage: "raw cancellation",
      normalizedMessage: "normalized cancellation",
      requestedAt: "2026-08-12T17:53:09+09:00",
    });

    expect(result).toMatchObject({
      kind: "success",
      transaction: {
        kind: "cancelled",
        transactionIds: ["transaction-preauthorization"],
      },
      notification: { state: "not-requested" },
    });
  });

  it.each([
    {
      intake: { kind: "cancellation-not-found" } as const,
      transaction: {
        kind: "rejected",
        code: "CANCELLATION_TARGET_NOT_FOUND",
      },
    },
    {
      intake: {
        kind: "needs-confirmation",
        captureLineageIds: ["lineage-a", "lineage-b"],
      } as const,
      transaction: {
        kind: "needsConfirmation",
        candidates: [
          { kind: "captureLineage", captureLineageId: "lineage-a" },
          { kind: "captureLineage", captureLineageId: "lineage-b" },
        ],
      },
    },
  ])(
    "취소 대상이 확정되지 않은 결과도 새 지출이나 편집 알림을 만들지 않는다",
    async ({ intake, transaction }) => {
      const result = await cancellationProcessor(intake).process({
        bearerCredential: "raw-credential",
        diagnosticRawMessage: "raw cancellation",
        normalizedMessage: "normalized cancellation",
        requestedAt: "2026-08-12T17:53:09+09:00",
      });

      expect(result).toMatchObject({
        kind: "success",
        transaction,
        notification: { state: "not-requested" },
      });
    },
  );
});

import { describe, expect, it } from "vitest";

import { createCaptureTransactionGatewayApplication } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/captureTransactionGatewayApplication";
import type { CaptureConfigurationQueryPort } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureConfigurationQueryPort";
import type {
  CaptureApprovalPersistenceCommand,
  CaptureCancellationPersistenceCommand,
  CaptureLedgerPersistencePort,
} from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureLedgerPersistencePort";
import type { CaptureTransactionGatewayPort } from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureTransactionGatewayPort";

export interface CaptureTransactionGatewaySubject
  extends CaptureTransactionGatewayPort {
  readonly approvals: readonly CaptureApprovalPersistenceCommand[];
  readonly cancellations: readonly CaptureCancellationPersistenceCommand[];
}

function configuration(): CaptureConfigurationQueryPort {
  return {
    load: async () => ({
      kind: "available",
      value: {
        cards: [
          {
            cardId: "card-own",
            ownerMemberId: "member-1",
            companyLabel: "국민",
            lastFour: "1234",
            lifecycleState: "active",
          },
          {
            cardId: "card-other",
            ownerMemberId: "member-2",
            companyLabel: "국민",
            lastFour: "9999",
            lifecycleState: "active",
          },
        ],
        merchantRules: [
          {
            ruleId: "contains-star",
            keyword: "스타",
            matchType: "contains",
            priority: 100,
            active: true,
            mapping: { merchant: "넓은 규칙", categoryId: "etc" },
          },
          {
            ruleId: "exact-starbucks",
            keyword: "스타벅스",
            matchType: "exact",
            active: true,
            mapping: {
              merchant: "스타벅스 코리아",
              categoryId: "cafe",
              memo: "정확 일치",
            },
          },
        ],
        activeCategoryIds: new Set(["etc", "cafe", "fixed"]),
        defaultCategoryId: "etc",
      },
    }),
  };
}

function branch(overrides: Record<string, unknown> = {}) {
  return {
    branchKey: "payment-1",
    merchant: "스타벅스",
    amountInWon: 6_000,
    occurredAt: "2026-07-21T10:05:00+09:00",
    accountingDate: "2026-07-21",
    sourceType: "kb-card",
    parser: { parserId: "kb-card-parser", parserVersion: "2.0.0" },
    rawPayloadHash:
      "sha256:1111111111111111111111111111111111111111111111111111111111111111",
    captureContext: {
      observationId: "observation-1",
      observationType: "approval" as const,
      originChannel: "android-notification" as const,
      creatorMemberId: "member-1",
      cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
    },
    ...overrides,
  };
}

function ledgerSpy() {
  const approvals: CaptureApprovalPersistenceCommand[] = [];
  const cancellations: CaptureCancellationPersistenceCommand[] = [];
  const ledger: CaptureLedgerPersistencePort = {
    recordApproval: async (command) => {
      approvals.push(command);
      return {
        kind: "recorded",
        transactionId: "transaction-1",
        editable: true,
        captureLineageId: "lineage-1",
        aggregateVersion: 1,
        quickEditSnapshot: {
          transactionId: "transaction-1",
          merchant: command.branch.merchant,
          amountInWon: command.branch.amountInWon,
          accountingDate: command.branch.accountingDate,
          localTime: command.branch.occurredAt.slice(11, 16),
          categoryId: command.branch.categoryId,
          memo: command.branch.memo,
          aggregateVersion: 1,
        },
      };
    },
    cancel: async (command) => {
      cancellations.push(command);
      return { kind: "cancelled", transactionIds: ["transaction-1"] };
    },
  };
  return { ledger, approvals, cancellations };
}

export function createSubject(): CaptureTransactionGatewaySubject {
  const spy = ledgerSpy();
  const gateway = createCaptureTransactionGatewayApplication({
    configuration: configuration(),
    ledger: spy.ledger,
  });
  return {
    record: (input) => gateway.record(input),
    approvals: spy.approvals,
    cancellations: spy.cancellations,
  };
}

describe("Capture configuration → Ledger application boundary", () => {
  it("현재 Actor 소유 카드만 인정하고 exact 규칙을 contains 우선순위보다 먼저 적용한다", async () => {
    const subject = createSubject();

    const result = await subject.record({
      householdId: "house-1",
      downstreamKey: "payment-1",
      branch: branch(),
    });

    expect(result).toMatchObject({
      kind: "recorded",
      transactionId: "transaction-1",
      aggregateVersion: 1,
    });
    expect(subject.approvals).toEqual([
      expect.objectContaining({
        householdId: "house-1",
        branch: expect.objectContaining({
          creatorMemberId: "member-1",
          canonicalCardId: "card-own",
          originalMerchant: "스타벅스",
          merchant: "스타벅스 코리아",
          categoryId: "cafe",
          memo: "정확 일치",
        }),
      }),
    ]);
  });

  it("마스킹된 카드 알림이 등록 카드 하나와 일치하면 표시용 끝 네 자리를 복원한다", async () => {
    const subject = createSubject();

    await subject.record({
      householdId: "house-1",
      downstreamKey: "payment-masked-card",
      branch: branch({
        captureContext: {
          ...branch().captureContext,
          cardEvidence: { companyLabel: "국민", maskedToken: "12**" },
        },
      }),
    });

    expect(subject.approvals).toEqual([
      expect.objectContaining({
        branch: expect.objectContaining({
          cardEvidence: { companyLabel: "국민", maskedToken: "12**" },
          resolvedCardEvidence: {
            companyLabel: "국민",
            lastFour: "1234",
          },
          canonicalCardId: "card-own",
        }),
      }),
    ]);
  });

  it("다른 가구원에게만 등록된 카드는 거래를 만들지 않는다", async () => {
    const subject = createSubject();

    const result = await subject.record({
      householdId: "house-1",
      downstreamKey: "payment-other-card",
      branch: branch({
        captureContext: {
          ...branch().captureContext,
          cardEvidence: { companyLabel: "국민", maskedToken: "9999" },
        },
      }),
    });

    expect(result).toEqual({
      kind: "rejected",
      code: "CARD_NOT_REGISTERED_FOR_ACTOR",
    });
    expect(subject.approvals).toEqual([]);
  });

  it("취소에도 같은 가맹점 규칙과 본인 카드 identity를 적용한 뒤 Ledger에 위임한다", async () => {
    const subject = createSubject();

    expect(
      await subject.record({
        householdId: "house-1",
        downstreamKey: "cancel-1",
        branch: branch({
          branchKey: "cancel-1",
          captureContext: {
            ...branch().captureContext,
            observationType: "cancellation",
          },
        }),
      }),
    ).toEqual({ kind: "cancelled", transactionIds: ["transaction-1"] });
    expect(subject.cancellations).toEqual([
      expect.objectContaining({
        branch: expect.objectContaining({
          merchant: "스타벅스 코리아",
          canonicalCardId: "card-own",
          cancellationDate: "2026-07-21",
        }),
      }),
    ]);
  });
});

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

  it("복합 카카오 source의 card discriminator는 등록 카드 검증과 기본 카테고리를 적용한다", async () => {
    const subject = createSubject();

    await subject.record({
      householdId: "house-1",
      downstreamKey: "kakao-card-1",
      branch: branch({
        merchant: "규칙없는가맹점",
        sourceType: "kakao-talk-financial-message",
        parser: {
          parserId: "kakao-talk-financial-message-parser",
          parserVersion: "1.0.0",
        },
        captureContext: {
          ...branch().captureContext,
          paymentKind: "card",
        },
      }),
    });

    expect(subject.approvals).toEqual([
      expect.objectContaining({
        branch: expect.objectContaining({
          sourceType: "kakao-talk-financial-message",
          canonicalCardId: "card-own",
          categoryId: "etc",
        }),
      }),
    ]);
  });

  it("복합 카카오 source의 bill discriminator만 카드 없이 fixed 지출을 허용한다", async () => {
    const subject = createSubject();

    await subject.record({
      householdId: "house-1",
      downstreamKey: "kakao-bill-1",
      branch: branch({
        merchant: "8월 도시가스요금",
        sourceType: "kakao-talk-financial-message",
        parser: {
          parserId: "kakao-talk-financial-message-parser",
          parserVersion: "1.0.0",
        },
        captureContext: {
          observationId: "observation-kakao-bill-1",
          observationType: "approval",
          paymentKind: "bill",
          billDueDate: "2026-07-21",
          originChannel: "android-notification",
          creatorMemberId: "member-1",
        },
      }),
    });

    expect(subject.approvals).toEqual([
      expect.objectContaining({
        branch: expect.objectContaining({
          sourceType: "kakao-talk-financial-message",
          categoryId: "fixed",
          originalMerchant: "8월 도시가스요금",
        }),
      }),
    ]);
    expect(subject.approvals[0].branch).not.toHaveProperty("canonicalCardId");
    expect(subject.approvals[0].branch).not.toHaveProperty("cardEvidence");
  });

  it("전환 전 카카오 도시가스 branch는 discriminator 없이도 fixed 호환 경로를 유지한다", async () => {
    const subject = createSubject();

    await subject.record({
      householdId: "house-1",
      downstreamKey: "legacy-kakao-bill-1",
      branch: branch({
        merchant: "7월 도시가스요금",
        sourceType: "city-gas-bill",
        parser: {
          parserId: "city-gas-bill-parser",
          parserVersion: "1.0.0",
        },
        captureContext: {
          observationId: "observation-legacy-kakao-bill-1",
          observationType: "approval",
          originChannel: "android-notification",
          creatorMemberId: "member-1",
        },
      }),
    });

    expect(subject.approvals).toEqual([
      expect.objectContaining({
        branch: expect.objectContaining({
          sourceType: "city-gas-bill",
          categoryId: "fixed",
        }),
      }),
    ]);
  });

  it("복합 카카오 source라도 card discriminator에서 카드 증거가 없으면 거부한다", async () => {
    const subject = createSubject();

    await expect(
      subject.record({
        householdId: "house-1",
        downstreamKey: "kakao-card-without-evidence",
        branch: branch({
          sourceType: "kakao-talk-financial-message",
          parser: {
            parserId: "kakao-talk-financial-message-parser",
            parserVersion: "1.0.0",
          },
          captureContext: {
            observationId: "observation-kakao-card-without-evidence",
            observationType: "approval",
            paymentKind: "card",
            originChannel: "android-notification",
            creatorMemberId: "member-1",
          },
        }),
      }),
    ).resolves.toEqual({
      kind: "rejected",
      code: "PAYMENT_KIND_EVIDENCE_MISMATCH",
    });
    expect(subject.approvals).toEqual([]);
  });

  it("카카오가 아닌 source가 bill discriminator를 주장하면 저장 전에 거부한다", async () => {
    const subject = createSubject();

    await expect(
      subject.record({
        householdId: "house-1",
        downstreamKey: "kb-forged-bill",
        branch: branch({
          merchant: "8월 도시가스요금",
          captureContext: {
            observationId: "observation-kb-forged-bill",
            observationType: "approval",
            paymentKind: "bill",
            billDueDate: "2026-07-21",
            originChannel: "android-notification",
            creatorMemberId: "member-1",
          },
        }),
      }),
    ).resolves.toEqual({
      kind: "rejected",
      code: "PAYMENT_KIND_EVIDENCE_MISMATCH",
    });
    expect(subject.approvals).toEqual([]);
    expect(subject.cancellations).toEqual([]);
  });

  it("카드 증거와 bill discriminator가 섞인 카카오 입력은 저장 전에 거부한다", async () => {
    const subject = createSubject();

    await expect(
      subject.record({
        householdId: "house-1",
        downstreamKey: "kakao-mixed-bill-card",
        branch: branch({
          merchant: "8월 도시가스요금",
          sourceType: "kakao-talk-financial-message",
          parser: {
            parserId: "kakao-talk-financial-message-parser",
            parserVersion: "1.0.0",
          },
          captureContext: {
            observationId: "observation-kakao-mixed-bill-card",
            observationType: "approval",
            paymentKind: "bill",
            billDueDate: "2026-07-21",
            originChannel: "android-notification",
            creatorMemberId: "member-1",
            cardEvidence: { companyLabel: "국민", maskedToken: "1234" },
          },
        }),
      }),
    ).resolves.toEqual({
      kind: "rejected",
      code: "PAYMENT_KIND_EVIDENCE_MISMATCH",
    });
    expect(subject.approvals).toEqual([]);
    expect(subject.cancellations).toEqual([]);
  });

  it("취소 관찰이 bill discriminator를 주장하면 저장 전에 거부한다", async () => {
    const subject = createSubject();

    await expect(
      subject.record({
        householdId: "house-1",
        downstreamKey: "kakao-cancellation-bill",
        branch: branch({
          merchant: "8월 도시가스요금",
          sourceType: "kakao-talk-financial-message",
          parser: {
            parserId: "kakao-talk-financial-message-parser",
            parserVersion: "1.0.0",
          },
          captureContext: {
            observationId: "observation-kakao-cancellation-bill",
            observationType: "cancellation",
            paymentKind: "bill",
            billDueDate: "2026-07-21",
            originChannel: "android-notification",
            creatorMemberId: "member-1",
          },
        }),
      }),
    ).resolves.toEqual({
      kind: "rejected",
      code: "PAYMENT_KIND_EVIDENCE_MISMATCH",
    });
    expect(subject.approvals).toEqual([]);
    expect(subject.cancellations).toEqual([]);
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

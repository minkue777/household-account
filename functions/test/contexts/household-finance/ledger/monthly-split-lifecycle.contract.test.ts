import { describe, expect, it } from "vitest";
import { createMonthlySplitLifecycleFixtureSubject } from "../../../support/monthly-split-lifecycle-fixture";

interface SplitTransaction {
  transactionId: string;
  householdId: string;
  transactionType: "expense" | "income";
  lifecycleState: "active" | "superseded";
  amountInWon: number;
  accountingDate: string;
  merchant: string;
  categoryId: string;
  memo: string;
  cardType: string;
  cardDisplay: string;
  creatorMemberId: string;
  source: string;
  originChannel: string;
  aggregateVersion: number;
  splitGroup?: { groupId: string; index: number; total: number; originalId: string };
}

type SplitResult =
  | { kind: "success"; transactionIds: readonly string[] }
  | { kind: "validation-error"; code: string }
  | { kind: "conflict"; code: string }
  | { kind: "retryable-failure"; code: string };

export interface MonthlySplitLifecycleSubject {
  collapse(input: {
    operationKey: string;
    groupId: string;
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<SplitResult>;
  reconfigure(input: {
    operationKey: string;
    groupId: string;
    months: number;
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<SplitResult>;
  splitNewManual(input: {
    operationKey: string;
    actor: { householdId: string; actingMemberId: string };
    draft: {
      transactionType: "expense" | "income";
      merchant: string;
      amountInWon: number;
      categoryId: string;
      accountingDate: string;
      memo: string;
    };
    months: number;
  }): Promise<SplitResult>;
  state(): readonly SplitTransaction[];
}

export function createSubject(fixture: {
  transactions?: readonly SplitTransaction[];
  now?: string;
  failAtWriteIndex?: number;
}): MonthlySplitLifecycleSubject {
  return createMonthlySplitLifecycleFixtureSubject(fixture);
}

const original = (): SplitTransaction => ({
  transactionId: "original",
  householdId: "house-1",
  transactionType: "expense",
  lifecycleState: "superseded",
  amountInWon: 10_000,
  accountingDate: "2026-01-31",
  categoryId: "fixed",
  merchant: "원본",
  memo: "원본 메모",
  cardType: "manual",
  cardDisplay: "수동",
  creatorMemberId: "member-a",
  source: "manual",
  originChannel: "web",
  aggregateVersion: 2,
});

const installment = (index: number): SplitTransaction => ({
  transactionId: `part-${index}`,
  householdId: "house-1",
  transactionType: "expense",
  lifecycleState: "active",
  amountInWon: 3_333,
  accountingDate: `2026-0${index}-28`,
  categoryId: "fixed",
  merchant: `원본 (${index}/3)`,
  memo: "원본 메모",
  cardType: "manual",
  cardDisplay: "수동",
  creatorMemberId: "member-a",
  source: "manual",
  originChannel: "web",
  aggregateVersion: 1,
  splitGroup: { groupId: "group-1", index, total: 3, originalId: "original" },
});

describe("월 분할 lifecycle 공개 계약", () => {
  it("[T-SPL-004][SPL-003][LED-009] collapse는 파생 거래를 제거하고 같은 원본 ID를 재활성화한다", async () => {
    const subject = createSubject({
      transactions: [original(), installment(1), installment(2), installment(3)],
    });

    const result = await subject.collapse({
      operationKey: "collapse-1",
      groupId: "group-1",
      expectedVersions: { "part-1": 1, "part-2": 1, "part-3": 1, original: 2 },
    });

    expect(result).toEqual({ kind: "success", transactionIds: ["original"] });
    expect(subject.state()).toEqual([
      expect.objectContaining({
        transactionId: "original",
        lifecycleState: "active",
        source: "manual",
        originChannel: "web",
        creatorMemberId: "member-a",
      }),
    ]);
  });

  it("[T-SPL-004][SPL-003][LED-008] 한 항목 version이 stale이면 collapse 전체를 거부한다", async () => {
    const initial = [original(), installment(1), installment(2), installment(3)];
    const subject = createSubject({ transactions: initial });

    const result = await subject.collapse({
      operationKey: "collapse-stale",
      groupId: "group-1",
      expectedVersions: { "part-1": 1, "part-2": 0, "part-3": 1, original: 2 },
    });

    expect(result).toEqual({ kind: "conflict", code: "VERSION_MISMATCH" });
    expect(subject.state()).toEqual(initial);
  });

  it("[T-SPL-005][SPL-004] 1개월 재구성은 service 경계에서 거부한다", async () => {
    const initial = [original(), installment(1), installment(2), installment(3)];
    const subject = createSubject({ transactions: initial });

    const result = await subject.reconfigure({
      operationKey: "reconfigure-invalid",
      groupId: "group-1",
      months: 1,
      expectedVersions: { "part-1": 1, "part-2": 1, "part-3": 1, original: 2 },
    });

    expect(result).toEqual({
      kind: "validation-error",
      code: "MONTHLY_SPLIT_REQUIRES_AT_LEAST_TWO_MONTHS",
    });
    expect(subject.state()).toEqual(initial);
  });

  it("[T-SPL-005][SPL-004][LED-008] 유효 재구성은 기존 그룹을 새 전체 집합으로 원자 교체한다", async () => {
    const subject = createSubject({
      transactions: [original(), installment(1), installment(2), installment(3)],
    });

    const result = await subject.reconfigure({
      operationKey: "reconfigure-4",
      groupId: "group-1",
      months: 4,
      expectedVersions: { "part-1": 1, "part-2": 1, "part-3": 1, original: 2 },
    });

    expect(result).toMatchObject({ kind: "success" });
    const activeParts = subject.state().filter(({ splitGroup }) => splitGroup);
    expect(activeParts).toHaveLength(4);
    expect(activeParts.map(({ splitGroup }) => splitGroup?.index)).toEqual([1, 2, 3, 4]);
    expect(activeParts.every(({ splitGroup }) => splitGroup?.total === 4)).toBe(true);
  });

  it("[T-SPL-006][SPL-005][SPL-006] 신규 수동 월 분할은 memo·manual 카드·creator와 내림 금액을 전 항목에 보존한다", async () => {
    const subject = createSubject({ now: "2026-07-20T09:17:00+09:00" });

    const result = await subject.splitNewManual({
      operationKey: "new-manual-3",
      actor: { householdId: "house-1", actingMemberId: "member-a" },
      draft: {
        transactionType: "expense",
        merchant: "보험료",
        amountInWon: 10_000,
        categoryId: "fixed",
        accountingDate: "2026-07-31",
        memo: "직접 입력한 메모",
      },
      months: 3,
    });

    expect(result).toMatchObject({ kind: "success" });
    expect(subject.state()).toHaveLength(4);
    expect(subject.state()[0]).toMatchObject({
      transactionId: "manual-original:new-manual-3",
      lifecycleState: "superseded",
      householdId: "house-1",
      transactionType: "expense",
      categoryId: "fixed",
    });
    expect(
      subject.state().slice(1).map(({ amountInWon, memo, cardType, cardDisplay, creatorMemberId }) => ({
        amountInWon,
        memo,
        cardType,
        cardDisplay,
        creatorMemberId,
      })),
    ).toEqual([
      {
        amountInWon: 3_333,
        memo: "직접 입력한 메모",
        cardType: "manual",
        cardDisplay: "수동",
        creatorMemberId: "member-a",
      },
      {
        amountInWon: 3_333,
        memo: "직접 입력한 메모",
        cardType: "manual",
        cardDisplay: "수동",
        creatorMemberId: "member-a",
      },
      {
        amountInWon: 3_333,
        memo: "직접 입력한 메모",
        cardType: "manual",
        cardDisplay: "수동",
        creatorMemberId: "member-a",
      },
    ]);
  });

  it("[T-SPL-006][SPL-006][SYS-007] 신규 수동 월 분할의 중간 실패는 일부 항목을 남기지 않는다", async () => {
    const subject = createSubject({
      now: "2026-07-20T09:17:00+09:00",
      failAtWriteIndex: 2,
    });

    const result = await subject.splitNewManual({
      operationKey: "new-manual-fail",
      actor: { householdId: "house-1", actingMemberId: "member-a" },
      draft: {
        transactionType: "expense",
        merchant: "보험료",
        amountInWon: 10_000,
        categoryId: "fixed",
        accountingDate: "2026-07-31",
        memo: "메모",
      },
      months: 3,
    });

    expect(result).toEqual({
      kind: "retryable-failure",
      code: "LEDGER_COMMIT_FAILED",
    });
    expect(subject.state()).toEqual([]);
  });
});

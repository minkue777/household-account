import { describe, expect, it } from "vitest";
import { createCapturedMonthlyCancellationFixtureSubject } from "../../../support/captured-monthly-cancellation-fixture";

export interface CapturedMonthlyTransaction {
  transactionId: string;
  householdId: string;
  lifecycleState: "active" | "superseded";
  amountInWon: number;
  captureLineageId: string;
  aggregateVersion: number;
  monthlyGroup?: {
    groupId: string;
    originalTransactionId: string;
    index: number;
    total: number;
  };
}

export interface CapturedMonthlyCancellationState {
  transactions: readonly CapturedMonthlyTransaction[];
  claims: readonly {
    fingerprint: string;
    captureLineageId: string;
    state: "active" | "cancelled";
    cancelledAt?: string;
  }[];
  cancelledLineages: readonly {
    captureLineageId: string;
    receiptId: string;
  }[];
  events: readonly {
    eventName: "CapturedLineageCancelled.v1";
    deletedTransactionIds: readonly string[];
  }[];
}

export type CapturedMonthlyCancellationResult =
  | {
      kind: "Cancelled";
      captureLineageId: string;
      deletedTransactionIds: readonly string[];
    }
  | { kind: "AlreadyCancelled"; captureLineageId: string }
  | { kind: "NotFound" }
  | { kind: "Conflict"; code: string }
  | { kind: "RetryableFailure"; code: string };

export interface CapturedMonthlyCancellationContractSubject {
  cancel(input: {
    actor: { householdId: string; memberId: string };
    cancellationKey: string;
    captureLineageId: string;
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<CapturedMonthlyCancellationResult>;
  snapshot(): CapturedMonthlyCancellationState;
}

export function createSubject(fixture: {
  now: string;
  state: CapturedMonthlyCancellationState;
}): CapturedMonthlyCancellationContractSubject {
  return createCapturedMonthlyCancellationFixtureSubject(fixture);
}

const original: CapturedMonthlyTransaction = {
  transactionId: "captured-original",
  householdId: "household-1",
  lifecycleState: "superseded",
  amountInWon: 10_000,
  captureLineageId: "lineage-captured",
  aggregateVersion: 2,
};

function part(index: number): CapturedMonthlyTransaction {
  return {
    transactionId: `captured-part-${index}`,
    householdId: "household-1",
    lifecycleState: "active",
    amountInWon: 3_333,
    captureLineageId: "lineage-captured",
    aggregateVersion: 1,
    monthlyGroup: {
      groupId: "monthly-group",
      originalTransactionId: "captured-original",
      index,
      total: 3,
    },
  };
}

const other: CapturedMonthlyTransaction = {
  transactionId: "other-lineage",
  householdId: "household-1",
  lifecycleState: "active",
  amountInWon: 10_000,
  captureLineageId: "lineage-other",
  aggregateVersion: 1,
};

const initialState: CapturedMonthlyCancellationState = {
  transactions: [original, part(1), part(2), part(3), other],
  claims: [
    {
      fingerprint: "fingerprint-captured",
      captureLineageId: "lineage-captured",
      state: "active",
    },
    {
      fingerprint: "fingerprint-other",
      captureLineageId: "lineage-other",
      state: "active",
    },
  ],
  cancelledLineages: [],
  events: [],
};

describe("captured 월 분할 lineage 취소 공개 계약", () => {
  it("[T-LED-003][T-SPL-004][SPL-003/LED-009] 취소는 superseded 원본과 월 분할 전체를 삭제하고 다른 lineage는 보존한다", async () => {
    const subject = createSubject({
      now: "2026-07-20T12:00:00+09:00",
      state: initialState,
    });
    const command = {
      actor: { householdId: "household-1", memberId: "member-1" },
      cancellationKey: "cancel-monthly",
      captureLineageId: "lineage-captured",
      expectedVersions: {
        "captured-original": 2,
        "captured-part-1": 1,
        "captured-part-2": 1,
        "captured-part-3": 1,
        "lineage-captured": 4,
      },
    };

    expect(await subject.cancel(command)).toEqual({
      kind: "Cancelled",
      captureLineageId: "lineage-captured",
      deletedTransactionIds: [
        "captured-original",
        "captured-part-1",
        "captured-part-2",
        "captured-part-3",
      ],
    });
    const state = subject.snapshot();
    expect(state.transactions).toEqual([other]);
    expect(state.claims).toEqual([
      {
        fingerprint: "fingerprint-captured",
        captureLineageId: "lineage-captured",
        state: "cancelled",
        cancelledAt: "2026-07-20T12:00:00+09:00",
      },
      {
        fingerprint: "fingerprint-other",
        captureLineageId: "lineage-other",
        state: "active",
      },
    ]);
    expect(state.cancelledLineages).toEqual([
      {
        captureLineageId: "lineage-captured",
        receiptId: "cancel-monthly",
      },
    ]);
    expect(state.events).toEqual([
      {
        eventName: "CapturedLineageCancelled.v1",
        deletedTransactionIds: [
          "captured-original",
          "captured-part-1",
          "captured-part-2",
          "captured-part-3",
        ],
      },
    ]);
  });

  it("[T-LED-003][LED-009] 같은 cancellation key 재실행은 claim을 다시 열거나 Event를 중복 생성하지 않는다", async () => {
    const subject = createSubject({
      now: "2026-07-20T12:00:00+09:00",
      state: initialState,
    });
    const command = {
      actor: { householdId: "household-1", memberId: "member-1" },
      cancellationKey: "cancel-monthly",
      captureLineageId: "lineage-captured",
      expectedVersions: {
        "captured-original": 2,
        "captured-part-1": 1,
        "captured-part-2": 1,
        "captured-part-3": 1,
        "lineage-captured": 4,
      },
    };

    const first = await subject.cancel(command);
    const replay = await subject.cancel(command);

    expect(first.kind).toBe("Cancelled");
    expect(replay).toEqual(first);
    expect(subject.snapshot().events).toHaveLength(1);
    expect(
      subject.snapshot().claims.find(
        ({ captureLineageId }) => captureLineageId === "lineage-captured",
      ),
    ).toMatchObject({ state: "cancelled" });
  });
});

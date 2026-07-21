import { describe, expect, it } from "vitest";
import {
  createCancellationAtomicityDriver,
  type CancellationAtomicityDriver,
  type CancellationAtomicityFixture,
  type CancellationTransactionFixture,
} from "../../../support/cancellation-atomicity-driver";

export interface CancellationAtomicityContractSubject
  extends CancellationAtomicityDriver {}

export function createSubject(
  fixture: CancellationAtomicityFixture,
): CancellationAtomicityContractSubject {
  return createCancellationAtomicityDriver(fixture);
}

const actor = { householdId: "household-1", memberId: "member-1" };

const matched = (captureLineageId: string) => ({
  kind: "matched" as const,
  captureLineageId,
});

const monthlyGroup: readonly CancellationTransactionFixture[] = [
  {
    transactionId: "monthly-original",
    captureLineageId: "lineage-monthly",
    state: "superseded",
  },
  {
    transactionId: "monthly-1",
    captureLineageId: "lineage-monthly",
    groupId: "group-1",
    state: "active",
  },
  {
    transactionId: "monthly-2",
    captureLineageId: "lineage-monthly",
    groupId: "group-1",
    state: "active",
  },
  {
    transactionId: "monthly-3",
    captureLineageId: "lineage-monthly",
    groupId: "group-1",
    state: "active",
  },
];

describe("취소 lineage 원자 실행 공개 계약", () => {
  it("[T-CAN-001][CAN-004/CAN-005] 월 분할 원거래를 취소하면 그룹 전체만 한 결과로 삭제한다", async () => {
    const unrelated: CancellationTransactionFixture = {
      transactionId: "unrelated-1",
      captureLineageId: "lineage-unrelated",
      state: "active",
    };
    const subject = createSubject({
      lineageVersion: 4,
      transactions: [...monthlyGroup, unrelated],
    });

    const result = await subject.cancel({
      actor,
      cancellationKey: "cancel-monthly",
      matchResult: matched("lineage-monthly"),
      expectedLineageVersion: 4,
    });

    expect(result).toMatchObject({
      kind: "Cancelled",
      captureLineageId: "lineage-monthly",
      deletedTransactionIds: expect.arrayContaining([
        "monthly-original",
        "monthly-1",
        "monthly-2",
        "monthly-3",
      ]),
      groupId: "group-1",
    });
    if (result.kind === "Cancelled") {
      expect(result.deletedTransactionIds).toHaveLength(4);
    }
    expect(subject.state().transactions).toEqual([unrelated]);
    expect(subject.state().cancellationReceipts).toHaveLength(1);
    expect(subject.state().cancellationReceipts[0]).toMatchObject({
      captureLineageId: "lineage-monthly",
      deletedTransactionIds: expect.arrayContaining([
        "monthly-original",
        "monthly-1",
        "monthly-2",
        "monthly-3",
      ]),
    });
    expect(subject.state().captureClaimTombstones).toEqual([
      {
        captureLineageId: "lineage-monthly",
        receiptId: "cancel-monthly",
      },
    ]);
    expect(subject.state().completionEventLineageIds).toEqual([
      "lineage-monthly",
    ]);
  });

  it("[T-CAN-001][CAN-005] commit 중간 실패는 일부 삭제·receipt·완료 event 없이 원상 유지한다", async () => {
    const subject = createSubject({
      lineageVersion: 4,
      transactions: monthlyGroup,
      commitOutcome: "failure",
    });

    expect(
      await subject.cancel({
        actor,
        cancellationKey: "cancel-monthly",
        matchResult: matched("lineage-monthly"),
        expectedLineageVersion: 4,
      }),
    ).toEqual({ kind: "RetryableFailure", code: "ATOMIC_COMMIT_FAILED" });
    expect(subject.state()).toEqual({
      transactions: monthlyGroup,
      cancellationReceipts: [],
      captureClaimTombstones: [],
      completionEventLineageIds: [],
    });
  });

  it("[T-CAN-001][CAN-005] stale lineage version도 write 0건으로 거부한다", async () => {
    const subject = createSubject({
      lineageVersion: 4,
      transactions: monthlyGroup,
    });

    expect(
      await subject.cancel({
        actor,
        cancellationKey: "cancel-monthly",
        matchResult: matched("lineage-monthly"),
        expectedLineageVersion: 3,
      }),
    ).toEqual({ kind: "Conflict", code: "VERSION_MISMATCH" });
    expect(subject.state()).toEqual({
      transactions: monthlyGroup,
      cancellationReceipts: [],
      captureClaimTombstones: [],
      completionEventLineageIds: [],
    });
  });

  it("[T-CAN-001][CAN-005/CAN-007] 같은 cancellation key 재실행은 최초 결과를 재생하고 tombstone·receipt·event를 중복하지 않는다", async () => {
    const subject = createSubject({
      lineageVersion: 4,
      transactions: monthlyGroup,
    });
    const command = {
      actor,
      cancellationKey: "cancel-monthly",
      matchResult: matched("lineage-monthly"),
      expectedLineageVersion: 4,
    };

    const first = await subject.cancel(command);
    const replay = await subject.cancel(command);

    expect(replay).toEqual(first);
    expect(subject.state().transactions).toEqual([]);
    expect(subject.state().cancellationReceipts).toHaveLength(1);
    expect(subject.state().captureClaimTombstones).toHaveLength(1);
    expect(subject.state().completionEventLineageIds).toEqual([
      "lineage-monthly",
    ]);
  });

  it.each([
    {
      name: "일치 원거래 없음",
      matchResult: {
        kind: "notFound" as const,
        resource: "cancellationTarget" as const,
      },
      expected: {
        kind: "NotFound" as const,
        resource: "cancellationTarget" as const,
      },
    },
    {
      name: "완전 일치 lineage 복수",
      matchResult: {
        kind: "needsConfirmation" as const,
        captureLineageIds: ["lineage-a", "lineage-b"],
      },
      expected: {
        kind: "NeedsConfirmation" as const,
        captureLineageIds: ["lineage-a", "lineage-b"],
      },
    },
  ])(
    "[T-CAN-002][T-CAN-003][CAN-003] $name 매칭 결과는 Ledger UoW 없이 무변경 종료한다",
    async ({ matchResult, expected }) => {
      const subject = createSubject({
        lineageVersion: 4,
        transactions: monthlyGroup,
      });

      expect(
        await subject.cancel({
          actor,
          cancellationKey: "cancel-noop",
          matchResult,
          expectedLineageVersion: 4,
        }),
      ).toEqual(expected);
      expect(subject.state()).toEqual({
        transactions: monthlyGroup,
        cancellationReceipts: [],
        captureClaimTombstones: [],
        completionEventLineageIds: [],
      });
    },
  );
});

import { describe, expect, it } from "vitest";

import { createQuickEditFifoFixture } from "../../../support/quick-edit-fifo-fixture";

export interface AndroidSessionScope {
  sessionGeneration: string;
  householdId: string;
  memberId: string;
}

export interface StoredTransactionSignal {
  transactionId: string;
  savedAt: string;
  displaySnapshot: {
    merchant: string;
    amountInWon: number;
    categoryId: string;
    memo: string;
  };
}

export interface PersistedQuickEditEntry {
  sessionGeneration: string;
  householdId: string;
  memberId: string;
  transactionId: string;
  sequence: number;
  enqueuedAt: string;
}

export type QuickEditOpenOutcome =
  | { kind: "Opened"; transactionId: string }
  | { kind: "Queued"; transactionId: string }
  | { kind: "AlreadyQueued"; transactionId: string }
  | { kind: "StorageFailure"; code: "QUEUE_WRITE_FAILED" };

export type QuickEditFinishOutcome =
  | { kind: "Advanced"; nextTransactionId: string }
  | { kind: "QueueDrained" }
  | { kind: "Retained"; transactionId: string };

export interface QuickEditQueueState {
  currentTransactionId?: string;
  pendingTransactionIds: readonly string[];
  persistedEntries: readonly PersistedQuickEditEntry[];
  presentedTransactionIds: readonly string[];
  skippedTransactionIds: readonly string[];
}

export interface QuickEditQueueSecurityEvidence {
  storageProtection: "android-keystore-backed-encryption";
  keyExportable: false;
  backupEligible: false;
  persistedFieldNames: readonly string[];
  containsDisplaySnapshotPlaintext: false;
}

export interface QuickEditFifoContractSubject {
  signalStoredTransaction(
    signal: StoredTransactionSignal,
  ): Promise<QuickEditOpenOutcome>;
  finishCurrent(
    result: "success" | "already-processed" | "explicit-close" | "conflict" | "retryable-failure",
  ): Promise<QuickEditFinishOutcome>;
  restartProcess(at?: string): Promise<void>;
  setNextQueueWriteResult(result: "success" | "failure"): void;
  state(): QuickEditQueueState;
  securityEvidence(): QuickEditQueueSecurityEvidence;
}

export function createSubject(_fixture?: {
  session?: AndroidSessionScope;
  restoredEntries?: readonly PersistedQuickEditEntry[];
  presentationChecks?: Readonly<
    Record<
      string,
      "active-and-authorized" | "stale" | "unauthorized" | "not-editable"
    >
  >;
}): QuickEditFifoContractSubject {
  return createQuickEditFifoFixture(_fixture);
}

const signal = (
  transactionId: string,
  savedAt: string,
): StoredTransactionSignal => ({
  transactionId,
  savedAt,
  displaySnapshot: {
    merchant: `가맹점-${transactionId}`,
    amountInWon: 12_000,
    categoryId: "category-food",
    memo: `민감 메모-${transactionId}`,
  },
});

describe("Android QuickEdit 내구성 FIFO 공개 계약", () => {
  it("[T-QE-003][QE-009][DEC-054] 현재 A를 유지하고 저장 완료 순서대로 B와 C를 한 번씩 표시한다", async () => {
    const subject = createSubject();

    expect(
      await subject.signalStoredTransaction(
        signal("transaction-A", "2026-07-19T10:00:00+09:00"),
      ),
    ).toEqual({ kind: "Opened", transactionId: "transaction-A" });
    expect(
      await subject.signalStoredTransaction(
        signal("transaction-B", "2026-07-19T10:00:01+09:00"),
      ),
    ).toEqual({ kind: "Queued", transactionId: "transaction-B" });
    expect(
      await subject.signalStoredTransaction(
        signal("transaction-C", "2026-07-19T10:00:02+09:00"),
      ),
    ).toEqual({ kind: "Queued", transactionId: "transaction-C" });

    expect(subject.state()).toMatchObject({
      currentTransactionId: "transaction-A",
      pendingTransactionIds: ["transaction-B", "transaction-C"],
    });
    expect(await subject.finishCurrent("success")).toEqual({
      kind: "Advanced",
      nextTransactionId: "transaction-B",
    });
    expect(await subject.finishCurrent("explicit-close")).toEqual({
      kind: "Advanced",
      nextTransactionId: "transaction-C",
    });
    expect(await subject.finishCurrent("already-processed")).toEqual({
      kind: "QueueDrained",
    });
    expect(subject.state()).toMatchObject({ pendingTransactionIds: [] });
    expect(subject.state().currentTransactionId).toBeUndefined();
  });

  it("[T-QE-003][QE-009] 같은 session의 같은 거래 재전달은 중복 entry나 두 번째 화면을 만들지 않는다", async () => {
    const subject = createSubject();
    const first = signal(
      "transaction-A",
      "2026-07-19T10:00:00+09:00",
    );

    await subject.signalStoredTransaction(first);
    expect(await subject.signalStoredTransaction(first)).toEqual({
      kind: "AlreadyQueued",
      transactionId: "transaction-A",
    });

    expect(subject.state().persistedEntries).toHaveLength(1);
    expect(subject.state().currentTransactionId).toBe("transaction-A");
  });

  it("[T-QE-003][QE-009] 같은 시각에 저장된 거래도 고유 sequence로 순서가 결정되고 process 재시작 뒤 이어진다", async () => {
    const subject = createSubject();
    const sameTime = "2026-07-19T10:00:00+09:00";

    await subject.signalStoredTransaction(signal("transaction-A", sameTime));
    await subject.signalStoredTransaction(signal("transaction-B", sameTime));
    await subject.signalStoredTransaction(signal("transaction-C", sameTime));
    await subject.restartProcess();

    expect(subject.state()).toMatchObject({
      currentTransactionId: "transaction-A",
      pendingTransactionIds: ["transaction-B", "transaction-C"],
    });
    const orderedEntries = [...subject.state().persistedEntries].sort(
      (left, right) => left.sequence - right.sequence,
    );
    expect(orderedEntries.map(({ transactionId }) => transactionId)).toEqual([
      "transaction-A",
      "transaction-B",
      "transaction-C",
    ]);
    expect(
      orderedEntries.every(
        (entry, index) =>
          index === 0 || entry.sequence > orderedEntries[index - 1].sequence,
      ),
    ).toBe(true);
  });

  it.each(["conflict", "retryable-failure"] as const)(
    "[T-QE-003][QE-009] 현재 거래의 %s에서는 현재 화면과 head를 유지하고 다음 거래로 진행하지 않는다",
    async (result) => {
      const subject = createSubject();
      await subject.signalStoredTransaction(
        signal("transaction-A", "2026-07-19T10:00:00+09:00"),
      );
      await subject.signalStoredTransaction(
        signal("transaction-B", "2026-07-19T10:00:01+09:00"),
      );

      expect(await subject.finishCurrent(result)).toEqual({
        kind: "Retained",
        transactionId: "transaction-A",
      });
      expect(subject.state()).toMatchObject({
        currentTransactionId: "transaction-A",
        pendingTransactionIds: ["transaction-B"],
      });
    },
  );

  it("[T-QE-003][QE-009] Queue 쓰기 실패는 이미 저장된 거래를 롤백하지 않지만 표시 대기열을 진행시키지도 않는다", async () => {
    const subject = createSubject();
    subject.setNextQueueWriteResult("failure");

    expect(
      await subject.signalStoredTransaction(
        signal("transaction-A", "2026-07-19T10:00:00+09:00"),
      ),
    ).toEqual({ kind: "StorageFailure", code: "QUEUE_WRITE_FAILED" });
    expect(subject.state()).toEqual({
      currentTransactionId: undefined,
      pendingTransactionIds: [],
      persistedEntries: [],
      presentedTransactionIds: [],
      skippedTransactionIds: [],
    });
  });

  it("[T-QE-003][QE-009][AND-009][DEC-054] durable Queue에는 암호화된 최소 scope·ID·순서만 남고 표시 snapshot은 평문·backup에 남지 않는다", async () => {
    const subject = createSubject({
      session: {
        sessionGeneration: "session-1",
        householdId: "household-1",
        memberId: "member-1",
      },
    });
    await subject.signalStoredTransaction(
      signal("transaction-A", "2026-07-19T10:00:00+09:00"),
    );

    const security = subject.securityEvidence();
    expect({ ...security, persistedFieldNames: undefined }).toEqual({
      storageProtection: "android-keystore-backed-encryption",
      keyExportable: false,
      backupEligible: false,
      persistedFieldNames: undefined,
      containsDisplaySnapshotPlaintext: false,
    });
    expect([...security.persistedFieldNames].sort()).toEqual(
      [
        "sessionGeneration",
        "householdId",
        "memberId",
        "transactionId",
        "sequence",
        "enqueuedAt",
      ].sort(),
    );
  });

  it("[T-QE-003][QE-009] 다음 화면 직전 최신 거래와 actor를 재검증해 stale·다른 session entry만 건너뛴다", async () => {
    const currentSession: AndroidSessionScope = {
      sessionGeneration: "session-current",
      householdId: "household-1",
      memberId: "member-1",
    };
    const restoredEntries: readonly PersistedQuickEditEntry[] = [
      {
        ...currentSession,
        transactionId: "transaction-A",
        sequence: 1,
        enqueuedAt: "2026-07-20T10:00:00+09:00",
      },
      {
        ...currentSession,
        transactionId: "transaction-stale",
        sequence: 2,
        enqueuedAt: "2026-07-20T10:00:01+09:00",
      },
      {
        sessionGeneration: "session-other",
        householdId: "household-other",
        memberId: "member-other",
        transactionId: "transaction-other-session",
        sequence: 3,
        enqueuedAt: "2026-07-20T10:00:02+09:00",
      },
      {
        ...currentSession,
        transactionId: "transaction-D",
        sequence: 4,
        enqueuedAt: "2026-07-20T10:00:03+09:00",
      },
    ];
    const subject = createSubject({
      session: currentSession,
      restoredEntries,
      presentationChecks: {
        "transaction-A": "active-and-authorized",
        "transaction-stale": "stale",
        "transaction-other-session": "active-and-authorized",
        "transaction-D": "active-and-authorized",
      },
    });

    await subject.restartProcess("2026-07-20T10:01:00+09:00");
    expect(subject.state().currentTransactionId).toBe("transaction-A");

    expect(await subject.finishCurrent("success")).toEqual({
      kind: "Advanced",
      nextTransactionId: "transaction-D",
    });
    expect(subject.state()).toMatchObject({
      currentTransactionId: "transaction-D",
      pendingTransactionIds: [],
      persistedEntries: [expect.objectContaining({ transactionId: "transaction-D" })],
      presentedTransactionIds: ["transaction-A", "transaction-D"],
      skippedTransactionIds: [
        "transaction-stale",
        "transaction-other-session",
      ],
    });
  });

  it("[T-QE-003][QE-009] 같은 session head도 최신 권한이 없거나 편집 불가이면 민감 화면 없이 제거하고 다음 유효 거래만 표시한다", async () => {
    const currentSession: AndroidSessionScope = {
      sessionGeneration: "session-current",
      householdId: "household-1",
      memberId: "member-1",
    };
    const restoredEntries: readonly PersistedQuickEditEntry[] = [
      {
        ...currentSession,
        transactionId: "transaction-unauthorized",
        sequence: 1,
        enqueuedAt: "2026-07-20T10:00:00+09:00",
      },
      {
        ...currentSession,
        transactionId: "transaction-not-editable",
        sequence: 2,
        enqueuedAt: "2026-07-20T10:00:01+09:00",
      },
      {
        ...currentSession,
        transactionId: "transaction-valid",
        sequence: 3,
        enqueuedAt: "2026-07-20T10:00:02+09:00",
      },
    ];
    const subject = createSubject({
      session: currentSession,
      restoredEntries,
      presentationChecks: {
        "transaction-unauthorized": "unauthorized",
        "transaction-not-editable": "not-editable",
        "transaction-valid": "active-and-authorized",
      },
    });

    await subject.restartProcess("2026-07-20T10:01:00+09:00");

    expect(subject.state()).toMatchObject({
      currentTransactionId: "transaction-valid",
      pendingTransactionIds: [],
      persistedEntries: [
        expect.objectContaining({ transactionId: "transaction-valid" }),
      ],
      presentedTransactionIds: ["transaction-valid"],
      skippedTransactionIds: [
        "transaction-unauthorized",
        "transaction-not-editable",
      ],
    });
    expect(subject.state().presentedTransactionIds).not.toEqual(
      expect.arrayContaining([
        "transaction-unauthorized",
        "transaction-not-editable",
      ]),
    );
  });

  it("[T-QE-003][QE-009][DEC-054] 오래된 QuickEdit entry에는 Capture Queue의 72시간 TTL을 적용하지 않는다", async () => {
    const currentSession: AndroidSessionScope = {
      sessionGeneration: "session-current",
      householdId: "household-1",
      memberId: "member-1",
    };
    const subject = createSubject({
      session: currentSession,
      restoredEntries: [
        {
          ...currentSession,
          transactionId: "transaction-old-but-active",
          sequence: 1,
          enqueuedAt: "2026-07-01T00:00:00+09:00",
        },
      ],
      presentationChecks: {
        "transaction-old-but-active": "active-and-authorized",
      },
    });

    await subject.restartProcess("2026-07-20T10:00:00+09:00");

    expect(subject.state()).toMatchObject({
      currentTransactionId: "transaction-old-but-active",
      pendingTransactionIds: [],
      persistedEntries: [
        expect.objectContaining({ transactionId: "transaction-old-but-active" }),
      ],
    });
  });

  it("복원 항목은 저장 배열의 순서와 무관하게 영속 sequence 순서로 표시한다", async () => {
    const session: AndroidSessionScope = {
      sessionGeneration: "session-current",
      householdId: "household-1",
      memberId: "member-1",
    };
    const subject = createSubject({
      session,
      restoredEntries: [
        {
          ...session,
          transactionId: "transaction-C",
          sequence: 30,
          enqueuedAt: "2026-07-20T10:00:02+09:00",
        },
        {
          ...session,
          transactionId: "transaction-A",
          sequence: 10,
          enqueuedAt: "2026-07-20T10:00:00+09:00",
        },
        {
          ...session,
          transactionId: "transaction-B",
          sequence: 20,
          enqueuedAt: "2026-07-20T10:00:01+09:00",
        },
      ],
    });

    await subject.restartProcess();

    expect(subject.state()).toMatchObject({
      currentTransactionId: "transaction-A",
      pendingTransactionIds: ["transaction-B", "transaction-C"],
    });
  });

  it("현재 Quick Edit이 없을 때 완료 신호는 안전하게 빈 대기열로 끝난다", async () => {
    const subject = createSubject();

    expect(await subject.finishCurrent("success")).toEqual({
      kind: "QueueDrained",
    });
    expect(subject.state().persistedEntries).toEqual([]);
  });

  it("기존 화면이 열린 상태에서 다음 항목 저장이 실패해도 현재 화면과 대기열을 보존한다", async () => {
    const subject = createSubject();
    await subject.signalStoredTransaction(
      signal("transaction-A", "2026-07-20T10:00:00+09:00"),
    );
    subject.setNextQueueWriteResult("failure");

    expect(
      await subject.signalStoredTransaction(
        signal("transaction-B", "2026-07-20T10:00:01+09:00"),
      ),
    ).toEqual({ kind: "StorageFailure", code: "QUEUE_WRITE_FAILED" });
    expect(subject.state()).toMatchObject({
      currentTransactionId: "transaction-A",
      pendingTransactionIds: [],
      persistedEntries: [
        expect.objectContaining({ transactionId: "transaction-A" }),
      ],
    });
  });
});

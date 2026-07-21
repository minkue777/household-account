import { describe, expect, it } from "vitest";
import { createBoundedReportingFixtureSubject } from "../../../support/bounded-reporting-fixture";

interface ReportingRequestIdentity {
  actorSessionGeneration: string;
  householdId: string;
  queryKey: string;
  queryRevision: number;
}

interface LedgerStatisticsFact {
  transactionId: string;
  accountingDate: string;
  amountInWon: number;
  transactionType: "expense" | "income";
}

interface LedgerSourcePage {
  cursor?: string;
  nextCursor?: string;
  sourceCheckpoint: string;
  items: readonly LedgerStatisticsFact[];
}

type LedgerSourceResponse =
  | { kind: "ready"; pages: readonly LedgerSourcePage[] }
  | { kind: "retryable-failure"; code: string }
  | { kind: "contract-failure"; code: string };

interface ReportingView {
  identity: ReportingRequestIdentity;
  totalExpenseInWon: number;
  sourceCheckpoint: string;
  rowCount: number;
}

type ReportingQueryResult =
  | { kind: "success"; value: ReportingView }
  | {
      kind: "retryable-failure";
      code: "SOURCE_WINDOW_INCOMPLETE" | string;
    }
  | { kind: "contract-failure"; code: string };

interface BoundedReportingSeed {
  responses: Readonly<
    Record<string, LedgerSourceResponse | Promise<LedgerSourceResponse>>
  >;
  maxRows: number;
  maxPages: number;
}

/** bounded source page와 화면 request revision을 조정하는 공개 계약입니다. */
export interface BoundedReportingQuerySubject {
  load(input: {
    identity: ReportingRequestIdentity;
    period: { startDate: string; endDate: string };
  }): Promise<ReportingQueryResult>;
  currentView(): ReportingView | undefined;
  clearActorSession(nextSessionGeneration: string): void;
}

export function createSubject(
  seed: BoundedReportingSeed,
): BoundedReportingQuerySubject {
  return createBoundedReportingFixtureSubject(seed);
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

const identity = (
  queryKey: string,
  queryRevision: number,
  actorSessionGeneration = "session-1",
): ReportingRequestIdentity => ({
  actorSessionGeneration,
  householdId: "house-1",
  queryKey,
  queryRevision,
});

const fact = (
  transactionId: string,
  amountInWon: number,
): LedgerStatisticsFact => ({
  transactionId,
  accountingDate: "2026-07-20",
  amountInWon,
  transactionType: "expense",
});

const period = { startDate: "2026-07-01", endDate: "2026-07-31" };

describe("Reporting bounded query와 obsolete 응답 계약", () => {
  it("[T-STAT-002][STAT-006/DEC-048] 동일 source window의 모든 cursor page를 완료한 뒤에만 전체 합계를 commit한다", async () => {
    const requestIdentity = identity("july", 1);
    const subject = createSubject({
      maxRows: 10,
      maxPages: 5,
      responses: {
        july: {
          kind: "ready",
          pages: [
            {
              sourceCheckpoint: "ledger-window-7",
              nextCursor: "cursor-2",
              items: [fact("expense-1", 10_000)],
            },
            {
              cursor: "cursor-2",
              sourceCheckpoint: "ledger-window-7",
              nextCursor: "cursor-3",
              items: [fact("expense-2", 20_000)],
            },
            {
              cursor: "cursor-3",
              sourceCheckpoint: "ledger-window-7",
              items: [fact("expense-3", 30_000)],
            },
          ],
        },
      },
    });

    const result = await subject.load({ identity: requestIdentity, period });

    expect(result).toEqual({
      kind: "success",
      value: {
        identity: requestIdentity,
        totalExpenseInWon: 60_000,
        sourceCheckpoint: "ledger-window-7",
        rowCount: 3,
      },
    });
    expect(subject.currentView()).toEqual(
      result.kind === "success" ? result.value : undefined,
    );
  });

  it("[T-STAT-002][STAT-006] row·page 안전 상한을 넘긴 부분 결과를 완전한 통계로 반영하지 않는다", async () => {
    const subject = createSubject({
      maxRows: 2,
      maxPages: 2,
      responses: {
        oversized: {
          kind: "ready",
          pages: [
            {
              sourceCheckpoint: "ledger-window-8",
              nextCursor: "cursor-2",
              items: [fact("expense-1", 10_000), fact("expense-2", 20_000)],
            },
            {
              cursor: "cursor-2",
              sourceCheckpoint: "ledger-window-8",
              nextCursor: "cursor-3",
              items: [fact("expense-3", 30_000)],
            },
          ],
        },
      },
    });

    expect(
      await subject.load({ identity: identity("oversized", 1), period }),
    ).toEqual({
      kind: "retryable-failure",
      code: "SOURCE_WINDOW_INCOMPLETE",
    });
    expect(subject.currentView()).toBeUndefined();
  });

  it("[T-STAT-002][STAT-006] page 사이 source checkpoint 변경은 합쳐 계산하지 않고 불완전 결과로 끝낸다", async () => {
    const subject = createSubject({
      maxRows: 10,
      maxPages: 5,
      responses: {
        moving: {
          kind: "ready",
          pages: [
            {
              sourceCheckpoint: "ledger-window-before",
              nextCursor: "cursor-2",
              items: [fact("expense-before", 10_000)],
            },
            {
              cursor: "cursor-2",
              sourceCheckpoint: "ledger-window-after",
              items: [fact("expense-after", 20_000)],
            },
          ],
        },
      },
    });

    expect(
      await subject.load({ identity: identity("moving", 1), period }),
    ).toEqual({
      kind: "retryable-failure",
      code: "SOURCE_WINDOW_INCOMPLETE",
    });
    expect(subject.currentView()).toBeUndefined();
  });

  it("[T-STAT-002][STAT-006] 필터 B 결과 뒤 늦게 도착한 필터 A 응답은 현재 view를 덮어쓰지 않는다", async () => {
    const sourceA = deferred<LedgerSourceResponse>();
    const sourceB = deferred<LedgerSourceResponse>();
    const subject = createSubject({
      maxRows: 10,
      maxPages: 5,
      responses: {
        "filter-a": sourceA.promise,
        "filter-b": sourceB.promise,
      },
    });

    const loadingA = subject.load({ identity: identity("filter-a", 1), period });
    const loadingB = subject.load({ identity: identity("filter-b", 2), period });
    sourceB.resolve({
      kind: "ready",
      pages: [
        {
          sourceCheckpoint: "window-b",
          items: [fact("expense-b", 20_000)],
        },
      ],
    });
    const resultB = await loadingB;
    expect(resultB.kind).toBe("success");

    sourceA.resolve({
      kind: "ready",
      pages: [
        {
          sourceCheckpoint: "window-a",
          items: [fact("expense-a", 10_000)],
        },
      ],
    });
    await loadingA;

    expect(subject.currentView()).toEqual(
      resultB.kind === "success" ? resultB.value : undefined,
    );
    expect(subject.currentView()?.identity.queryKey).toBe("filter-b");
  });

  it("[T-STAT-002][STAT-006] logout 뒤 도착한 이전 session 응답은 비워진 화면 상태를 복구하지 않는다", async () => {
    const source = deferred<LedgerSourceResponse>();
    const subject = createSubject({
      maxRows: 10,
      maxPages: 5,
      responses: { july: source.promise },
    });

    const loading = subject.load({ identity: identity("july", 1), period });
    subject.clearActorSession("session-2");
    source.resolve({
      kind: "ready",
      pages: [
        {
          sourceCheckpoint: "old-session-window",
          items: [fact("old-expense", 10_000)],
        },
      ],
    });
    await loading;

    expect(subject.currentView()).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";
import { createDividendSweepRecoveryFixture } from "../../support/dividend-sweep-recovery-fixture";

interface PositionHistoryObservation {
  assetId: string;
  instrumentCode: string;
  snapshotDate: string;
  quantity: number;
  observedAt: string;
  sourceVersion: string;
}

interface PositionHistoryPage {
  cursor?: string;
  nextCursor?: string;
  observations: readonly PositionHistoryObservation[];
}

type PositionHistoryFixture =
  | { kind: "ready"; pages: readonly PositionHistoryPage[] }
  | { kind: "no-data" }
  | { kind: "retryable-failure"; code: string };

interface DividendEventView {
  eventId: string;
  householdId: string;
  sourceDisclosureId: string;
  sourceAssetIds: readonly string[];
  instrumentCode: string;
  recordDate: string;
  paymentDate: string;
  perShareAmountInWon: number;
  status: "announced" | "fixed" | "paid";
  eligibleQuantity?: number;
  totalAmountInWon?: number;
  aggregateVersion: number;
}

interface EligibilityEvidence {
  assetId: string;
  selectedSnapshotDate: string;
  selectedObservedAt: string;
  sourceVersion: string;
  quantity: number;
  selectionKind: "exact" | "nearest";
}

type RecoverEligibilityResult =
  | {
      kind: "success";
      eventId: string;
      eligibleQuantity: number;
      evidence: readonly EligibilityEvidence[];
    }
  | { kind: "no-data"; code: "POSITION_HISTORY_NOT_OBSERVED" }
  | { kind: "retryable-failure"; code: string };

interface DividendSweepReceipt {
  receiptId: string;
  occurrenceId: string;
  eventId: string;
  fromStatus: DividendEventView["status"];
  toStatus: DividendEventView["status"];
  resultingVersion: number;
}

interface DividendChangedEvent {
  eventType: "DividendEventChanged.v1";
  eventId: string;
  aggregateVersion: number;
  status: DividendEventView["status"];
}

interface DividendSweepResult {
  kind: "complete" | "partial-failure";
  occurrenceId: string;
  pageReceipts: readonly {
    pageNumber: number;
    eventIds: readonly string[];
    checkpointAfter?: string;
    terminal: true;
  }[];
  changedEventIds: readonly string[];
  retryableFailures: readonly { eventId: string; code: string }[];
}

type DividendCorrectionResult =
  | { kind: "success"; event: DividendEventView }
  | { kind: "already-processed"; code: "PAID_DIVIDEND_IMMUTABLE" };

interface DividendSweepRecoveryFixture {
  events: readonly DividendEventView[];
  positionHistoryByEventId: Readonly<Record<string, PositionHistoryFixture>>;
  assetLifecycleById?: Readonly<
    Record<string, "active" | "deleted" | "purged">
  >;
  pageSize?: number;
}

/** Position history 복구와 discovery 독립 배당 lifecycle sweep 계약입니다. */
export interface DividendSweepRecoverySubject {
  recoverEligibility(eventId: string): Promise<RecoverEligibilityResult>;
  runLifecycleSweep(input: {
    occurrenceId: string;
    asOfDate: string;
    resumeFromCheckpoint?: string;
  }): Promise<DividendSweepResult>;
  applyUnpaidCorrection(command: {
    commandId: string;
    idempotencyKey: string;
    eventId: string;
    sourceDisclosureId: string;
    recordDate: string;
    paymentDate: string;
    perShareAmountInWon: number;
  }): Promise<DividendCorrectionResult>;
  getEvent(eventId: string): Promise<DividendEventView | undefined>;
  listEvents(): Promise<readonly DividendEventView[]>;
  receipts(): readonly DividendSweepReceipt[];
  recordedEvents(): readonly DividendChangedEvent[];
}

export function createSubject(
  fixture: DividendSweepRecoveryFixture,
): DividendSweepRecoverySubject {
  return createDividendSweepRecoveryFixture(fixture);
}

function event(
  overrides: Partial<DividendEventView> = {},
): DividendEventView {
  return {
    eventId: "dividend-1",
    householdId: "house-1",
    sourceDisclosureId: "disclosure-1",
    sourceAssetIds: ["asset-stock"],
    instrumentCode: "069500",
    recordDate: "2026-07-10",
    paymentDate: "2026-07-20",
    perShareAmountInWon: 100,
    status: "announced",
    aggregateVersion: 1,
    ...overrides,
  };
}

function observation(
  snapshotDate: string,
  quantity: number,
  overrides: Partial<PositionHistoryObservation> = {},
): PositionHistoryObservation {
  return {
    assetId: "asset-stock",
    instrumentCode: "069500",
    snapshotDate,
    quantity,
    observedAt: `${snapshotDate}T14:00:00.000Z`,
    sourceVersion: `${snapshotDate}:${quantity}`,
    ...overrides,
  };
}

function ready(
  observations: readonly PositionHistoryObservation[],
): PositionHistoryFixture {
  return {
    kind: "ready",
    pages: [{ observations }],
  };
}

describe("Dividends 최근접 수량 복구·시간 기반 sweep 계약", () => {
  it("[T-DIV-001][DIV-005/DEC-014] 기준일 exact snapshot을 최근접 후보보다 우선하고 같은 날 마지막 관찰을 선택한다", async () => {
    const subject = createSubject({
      events: [event()],
      positionHistoryByEventId: {
        "dividend-1": ready([
          observation("2026-07-09", 9),
          observation("2026-07-10", 10, {
            observedAt: "2026-07-10T01:00:00.000Z",
            sourceVersion: "10:early",
          }),
          observation("2026-07-10", 12, {
            observedAt: "2026-07-10T14:00:00.000Z",
            sourceVersion: "10:last",
          }),
          observation("2026-07-11", 11),
        ]),
      },
    });

    expect(await subject.recoverEligibility("dividend-1")).toEqual({
      kind: "success",
      eventId: "dividend-1",
      eligibleQuantity: 12,
      evidence: [
        {
          assetId: "asset-stock",
          selectedSnapshotDate: "2026-07-10",
          selectedObservedAt: "2026-07-10T14:00:00.000Z",
          sourceVersion: "10:last",
          quantity: 12,
          selectionKind: "exact",
        },
      ],
    });
  });

  it.each([
    {
      label: "거리 비동률이면 더 가까운 미래 날짜",
      observations: [
        observation("2026-07-08", 8),
        observation("2026-07-11", 11),
      ],
      expectedDate: "2026-07-11",
      expectedQuantity: 11,
    },
    {
      label: "동률이면 더 이른 날짜",
      observations: [
        observation("2026-07-09", 9),
        observation("2026-07-11", 11),
      ],
      expectedDate: "2026-07-09",
      expectedQuantity: 9,
    },
    {
      label: "한쪽 후보만 있으면 그 날짜",
      observations: [observation("2026-07-12", 12)],
      expectedDate: "2026-07-12",
      expectedQuantity: 12,
    },
  ])(
    "[T-DIV-001][DIV-005/DEC-014] $label를 고정된 eligibility evidence로 사용한다",
    async ({ observations, expectedDate, expectedQuantity }) => {
      const subject = createSubject({
        events: [event()],
        positionHistoryByEventId: {
          "dividend-1": ready(observations),
        },
      });

      expect(await subject.recoverEligibility("dividend-1")).toEqual({
        kind: "success",
        eventId: "dividend-1",
        eligibleQuantity: expectedQuantity,
        evidence: [
          expect.objectContaining({
            selectedSnapshotDate: expectedDate,
            quantity: expectedQuantity,
            selectionKind: "nearest",
          }),
        ],
      });
    },
  );

  it("[T-DIV-001][DIV-005] page 경계 밖의 더 가까운 snapshot까지 모두 읽은 뒤 수량을 선택한다", async () => {
    const subject = createSubject({
      events: [event()],
      positionHistoryByEventId: {
        "dividend-1": {
          kind: "ready",
          pages: [
            {
              nextCursor: "page-2",
              observations: [observation("2026-07-01", 1)],
            },
            {
              cursor: "page-2",
              observations: [observation("2026-07-09", 9)],
            },
          ],
        },
      },
    });

    expect(await subject.recoverEligibility("dividend-1")).toEqual(
      expect.objectContaining({
        kind: "success",
        eligibleQuantity: 9,
        evidence: [
          expect.objectContaining({ selectedSnapshotDate: "2026-07-09" }),
        ],
      }),
    );
  });

  it.each([
    {
      source: { kind: "no-data" } as const,
      expected: {
        kind: "no-data",
        code: "POSITION_HISTORY_NOT_OBSERVED",
      },
    },
    {
      source: {
        kind: "retryable-failure",
        code: "POSITION_HISTORY_UNAVAILABLE",
      } as const,
      expected: {
        kind: "retryable-failure",
        code: "POSITION_HISTORY_UNAVAILABLE",
      },
    },
  ])(
    "[T-DIV-001][DIV-005] $source.kind를 0주 성공으로 바꾸지 않는다",
    async ({ source, expected }) => {
      const subject = createSubject({
        events: [event()],
        positionHistoryByEventId: { "dividend-1": source },
      });

      expect(await subject.recoverEligibility("dividend-1")).toEqual(expected);
      expect(await subject.getEvent("dividend-1")).toEqual(event());
      expect(subject.receipts()).toEqual([]);
      expect(subject.recordedEvents()).toEqual([]);
    },
  );

  it("[T-DIV-003][DIV-006/DEC-017] source Asset이 모두 deleted여도 기존 announced Event는 보존된 history로 fixed 전이한다", async () => {
    const subject = createSubject({
      events: [event()],
      assetLifecycleById: { "asset-stock": "deleted" },
      positionHistoryByEventId: {
        "dividend-1": ready([observation("2026-07-09", 9)]),
      },
    });

    const result = await subject.runLifecycleSweep({
      occurrenceId: "dividend-sweep:2026-07-10T10",
      asOfDate: "2026-07-10",
    });

    expect(result).toMatchObject({
      kind: "complete",
      changedEventIds: ["dividend-1"],
      retryableFailures: [],
    });
    expect(await subject.getEvent("dividend-1")).toEqual(
      expect.objectContaining({
        status: "fixed",
        eligibleQuantity: 9,
        totalAmountInWon: 900,
        aggregateVersion: 2,
      }),
    );
    expect(subject.receipts()).toEqual([
      expect.objectContaining({
        eventId: "dividend-1",
        fromStatus: "announced",
        toStatus: "fixed",
        resultingVersion: 2,
      }),
    ]);
    expect(subject.recordedEvents()).toEqual([
      {
        eventType: "DividendEventChanged.v1",
        eventId: "dividend-1",
        aggregateVersion: 2,
        status: "fixed",
      },
    ]);
  });

  it("[T-DIV-003][DIV-006] discovery 결과가 없어도 기존 fixed Event의 지급일 sweep은 paid로 전이한다", async () => {
    const fixed = event({
      status: "fixed",
      eligibleQuantity: 10,
      totalAmountInWon: 1_000,
      aggregateVersion: 2,
    });
    const subject = createSubject({
      events: [fixed],
      assetLifecycleById: { "asset-stock": "purged" },
      positionHistoryByEventId: {},
    });

    await subject.runLifecycleSweep({
      occurrenceId: "dividend-sweep:2026-07-20T09",
      asOfDate: "2026-07-20",
    });

    expect(await subject.getEvent("dividend-1")).toEqual(
      expect.objectContaining({
        status: "paid",
        eligibleQuantity: 10,
        totalAmountInWon: 1_000,
        aggregateVersion: 3,
      }),
    );
    expect(subject.receipts()).toEqual([
      expect.objectContaining({
        fromStatus: "fixed",
        toStatus: "paid",
      }),
    ]);
  });

  it("[T-DIV-003][DIV-006] 미지급 fixed 정정은 같은 Event에 최신 공시와 재계산된 eligibility·총액을 원자 교체한다", async () => {
    const fixed = event({
      status: "fixed",
      eligibleQuantity: 10,
      totalAmountInWon: 1_000,
      aggregateVersion: 2,
    });
    const subject = createSubject({
      events: [fixed],
      positionHistoryByEventId: {
        "dividend-1": ready([
          observation("2026-07-12", 20, {
            sourceVersion: "corrected-record-date",
          }),
        ]),
      },
    });

    const corrected = await subject.applyUnpaidCorrection({
      commandId: "correct-dividend-1",
      idempotencyKey: "correct-dividend-1",
      eventId: "dividend-1",
      sourceDisclosureId: "disclosure-correction-1",
      recordDate: "2026-07-12",
      paymentDate: "2026-07-22",
      perShareAmountInWon: 120,
    });

    expect(corrected).toEqual({
      kind: "success",
      event: {
        ...fixed,
        sourceDisclosureId: "disclosure-correction-1",
        recordDate: "2026-07-12",
        paymentDate: "2026-07-22",
        perShareAmountInWon: 120,
        eligibleQuantity: 20,
        totalAmountInWon: 2_400,
        aggregateVersion: 3,
      },
    });
    expect(await subject.listEvents()).toEqual([
      corrected.kind === "success" ? corrected.event : undefined,
    ]);
    expect(JSON.stringify(await subject.getEvent("dividend-1"))).not.toContain(
      '"totalAmountInWon":1000',
    );
    expect(subject.recordedEvents()).toEqual([
      {
        eventType: "DividendEventChanged.v1",
        eventId: "dividend-1",
        aggregateVersion: 3,
        status: "fixed",
      },
    ]);
  });

  it("[T-DIV-003][DIV-006] 여러 page sweep 재전달은 최초 receipt를 재생하고 Event를 중복 전이하지 않는다", async () => {
    const second = event({
      eventId: "dividend-2",
      sourceDisclosureId: "disclosure-2",
      sourceAssetIds: ["asset-stock-2"],
    });
    const subject = createSubject({
      events: [event(), second],
      positionHistoryByEventId: {
        "dividend-1": ready([observation("2026-07-10", 10)]),
        "dividend-2": ready([
          observation("2026-07-10", 20, { assetId: "asset-stock-2" }),
        ]),
      },
      pageSize: 1,
    });
    const input = {
      occurrenceId: "dividend-sweep:2026-07-10T10",
      asOfDate: "2026-07-10",
    };

    const first = await subject.runLifecycleSweep(input);
    const stateAfterFirst = await subject.listEvents();
    const replay = await subject.runLifecycleSweep(input);

    expect(first.pageReceipts.map(({ eventIds }) => eventIds)).toEqual([
      ["dividend-1"],
      ["dividend-2"],
    ]);
    expect(replay).toEqual(first);
    expect(await subject.listEvents()).toEqual(stateAfterFirst);
    expect(subject.receipts()).toHaveLength(2);
    expect(subject.recordedEvents()).toHaveLength(2);
  });
});

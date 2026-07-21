import { describe, expect, it } from 'vitest';
import { createDividendLifecycleFixture } from '../../support/dividend-lifecycle-fixture';

interface DividendDisclosure {
  source: 'KIND';
  sourceDisclosureId: string;
  correctsSourceDisclosureId?: string;
  disclosureState: 'active' | 'cancelled';
  instrumentCode: string;
  recordDate: string;
  paymentDate: string;
  perShareAmount: number;
}

interface PositionSnapshot {
  assetId: string;
  instrumentCode: string;
  snapshotDate: string;
  quantity: number;
  observedAt: string;
  sourceVersion: string;
}

type DividendStatus = 'announced' | 'fixed' | 'paid';

interface DividendEventView {
  eventId: string;
  sourceDisclosureId: string;
  instrumentCode: string;
  recordDate: string;
  paymentDate: string;
  perShareAmount: number;
  status: DividendStatus;
  eligibleQuantity?: number;
  totalAmount?: number;
  paidAt?: string;
  eligibilityContributions?: readonly {
    assetId: string;
    quantity: number;
    kind: 'record-date-position' | 'nearest-position-snapshot';
    snapshotDate: string;
    sourceVersion: string;
  }[];
}

type DividendCommandResult =
  | { kind: 'success'; event?: DividendEventView; removedEventId?: string }
  | { kind: 'no-change'; code: string }
  | { kind: 'already-processed'; code: 'PAID_DIVIDEND_IMMUTABLE'; eventId: string }
  | { kind: 'no-data'; code: string }
  | { kind: 'retryable-failure'; code: string };

type DividendIntegrationEvent =
  | { eventType: 'DividendEventChanged.v1'; aggregateId: string; aggregateVersion: number }
  | { eventType: 'DividendEventRemoved.v1'; aggregateId: string; reason: 'DISCLOSURE_CANCELLED' };

interface AnnualDividendView {
  monthlyAmounts: readonly number[];
  events: Readonly<Record<string, DividendEventView>>;
}

interface DividendSubjectFixture {
  positionSnapshots?: readonly PositionSnapshot[];
}

/** 배당 Canonical Event와 파생 Projection의 공개 행위 계약입니다. */
export interface DividendLifecycleSubject {
  upsertAnnouncement(command: {
    commandId: string;
    idempotencyKey: string;
    householdId: string;
    disclosure: DividendDisclosure;
  }): Promise<DividendCommandResult>;
  advanceStatus(command: {
    commandId: string;
    idempotencyKey: string;
    householdId: string;
    eventId: string;
    asOfDate: string;
  }): Promise<DividendCommandResult>;
  observeDisclosureNoData(sourceDisclosureId: string): Promise<DividendCommandResult>;
  queryEvents(householdId: string, year: number): Promise<readonly DividendEventView[]>;
  rebuildAnnual(householdId: string, year: number): Promise<AnnualDividendView>;
  recordedIntegrationEvents(): readonly DividendIntegrationEvent[];
}

export function createSubject(fixture: DividendSubjectFixture = {}): DividendLifecycleSubject {
  return createDividendLifecycleFixture(fixture);
}

const disclosure = (overrides: Partial<DividendDisclosure> = {}): DividendDisclosure => ({
  source: 'KIND',
  sourceDisclosureId: 'disclosure-1',
  disclosureState: 'active',
  instrumentCode: '069500',
  recordDate: '2026-07-10',
  paymentDate: '2026-07-20',
  perShareAmount: 100,
  ...overrides,
});

describe('DividendLifecycle 공개 계약', () => {
  it('[T-DIV-001][DIV-005] 기준일 snapshot이 없고 9일·11일이 동률이면 이전인 9일 수량으로 fixed 전이한다', async () => {
    const subject = createSubject({
      positionSnapshots: [
        {
          assetId: 'asset-a',
          instrumentCode: '069500',
          snapshotDate: '2026-07-09',
          quantity: 9,
          observedAt: '2026-07-09T14:00:00.000Z',
          sourceVersion: '9',
        },
        {
          assetId: 'asset-a',
          instrumentCode: '069500',
          snapshotDate: '2026-07-11',
          quantity: 11,
          observedAt: '2026-07-11T14:00:00.000Z',
          sourceVersion: '11',
        },
      ],
    });
    const created = await subject.upsertAnnouncement({
      commandId: 'create-1',
      idempotencyKey: 'create-1',
      householdId: 'house-1',
      disclosure: disclosure(),
    });
    expect(created.kind).toBe('success');
    const eventId = created.kind === 'success' ? created.event?.eventId : undefined;

    const advanced = await subject.advanceStatus({
      commandId: 'advance-1',
      idempotencyKey: 'advance-1',
      householdId: 'house-1',
      eventId: eventId!,
      asOfDate: '2026-07-10',
    });

    expect(advanced).toEqual({
      kind: 'success',
      event: expect.objectContaining({
        eventId,
        status: 'fixed',
        eligibleQuantity: 9,
        totalAmount: 900,
        eligibilityContributions: [
          {
            assetId: 'asset-a',
            quantity: 9,
            kind: 'nearest-position-snapshot',
            snapshotDate: '2026-07-09',
            sourceVersion: '9',
          },
        ],
      }),
    });
  });

  it('[T-DIV-003][DIV-003/DIV-006] 지급 전 정정은 안정 공시 ID의 같은 Event를 교체하고 별도 revision Event를 만들지 않는다', async () => {
    const subject = createSubject();
    const first = await subject.upsertAnnouncement({
      commandId: 'create-1',
      idempotencyKey: 'create-1',
      householdId: 'house-1',
      disclosure: disclosure(),
    });
    expect(first.kind).toBe('success');
    const originalEventId = first.kind === 'success' ? first.event?.eventId : undefined;

    const corrected = await subject.upsertAnnouncement({
      commandId: 'correct-1',
      idempotencyKey: 'correct-1',
      householdId: 'house-1',
      disclosure: disclosure({
        sourceDisclosureId: 'disclosure-correction-1',
        correctsSourceDisclosureId: 'disclosure-1',
        recordDate: '2026-07-12',
        paymentDate: '2026-07-22',
        perShareAmount: 120,
      }),
    });
    const events = await subject.queryEvents('house-1', 2026);

    expect(corrected).toEqual({
      kind: 'success',
      event: expect.objectContaining({
        eventId: originalEventId,
        recordDate: '2026-07-12',
        paymentDate: '2026-07-22',
        perShareAmount: 120,
      }),
    });
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe(originalEventId);
  });

  it('[T-DIV-003][DIV-006] Provider NoData는 Event를 지우지 않고 명시적 지급 전 취소만 제거한다', async () => {
    const subject = createSubject();
    const created = await subject.upsertAnnouncement({
      commandId: 'create-1',
      idempotencyKey: 'create-1',
      householdId: 'house-1',
      disclosure: disclosure(),
    });
    const eventId = created.kind === 'success' ? created.event?.eventId : undefined;

    expect(await subject.observeDisclosureNoData('disclosure-1')).toEqual({
      kind: 'no-change',
      code: 'NO_DISCLOSURES',
    });
    expect(await subject.queryEvents('house-1', 2026)).toHaveLength(1);

    const cancelled = await subject.upsertAnnouncement({
      commandId: 'cancel-1',
      idempotencyKey: 'cancel-1',
      householdId: 'house-1',
      disclosure: disclosure({ disclosureState: 'cancelled' }),
    });

    expect(cancelled).toEqual({ kind: 'success', removedEventId: eventId });
    expect(await subject.queryEvents('house-1', 2026)).toEqual([]);
    expect(subject.recordedIntegrationEvents()).toContainEqual({
      eventType: 'DividendEventRemoved.v1',
      aggregateId: eventId,
      reason: 'DISCLOSURE_CANCELLED',
    });
  });

  it('[T-DIV-003][DIV-006] paid Event는 이후 정정과 취소에도 완전히 불변이다', async () => {
    const subject = createSubject({
      positionSnapshots: [
        {
          assetId: 'asset-a',
          instrumentCode: '069500',
          snapshotDate: '2026-07-10',
          quantity: 10,
          observedAt: '2026-07-10T14:00:00.000Z',
          sourceVersion: '10',
        },
      ],
    });
    const created = await subject.upsertAnnouncement({
      commandId: 'create-1',
      idempotencyKey: 'create-1',
      householdId: 'house-1',
      disclosure: disclosure(),
    });
    const eventId = created.kind === 'success' ? created.event?.eventId : undefined;
    await subject.advanceStatus({
      commandId: 'advance-1',
      idempotencyKey: 'advance-1',
      householdId: 'house-1',
      eventId: eventId!,
      asOfDate: '2026-07-20',
    });
    const before = await subject.queryEvents('house-1', 2026);

    const correction = await subject.upsertAnnouncement({
      commandId: 'correct-after-paid',
      idempotencyKey: 'correct-after-paid',
      householdId: 'house-1',
      disclosure: disclosure({ perShareAmount: 999 }),
    });
    const cancellation = await subject.upsertAnnouncement({
      commandId: 'cancel-after-paid',
      idempotencyKey: 'cancel-after-paid',
      householdId: 'house-1',
      disclosure: disclosure({ disclosureState: 'cancelled' }),
    });

    expect(correction).toEqual({ kind: 'already-processed', code: 'PAID_DIVIDEND_IMMUTABLE', eventId });
    expect(cancellation).toEqual({ kind: 'already-processed', code: 'PAID_DIVIDEND_IMMUTABLE', eventId });
    expect(await subject.queryEvents('house-1', 2026)).toEqual(before);
    expect(before[0]).toEqual(expect.objectContaining({ status: 'paid', perShareAmount: 100, totalAmount: 1_000 }));
  });

  it('[T-DIV-003][DIV-001/DIV-004] fixed·paid만 Canonical eventId key로 지급 월 12개월 Projection에 한 번 반영한다', async () => {
    const subject = createSubject({
      positionSnapshots: [
        {
          assetId: 'asset-a',
          instrumentCode: '069500',
          snapshotDate: '2026-07-10',
          quantity: 10,
          observedAt: '2026-07-10T14:00:00.000Z',
          sourceVersion: '10',
        },
      ],
    });
    const created = await subject.upsertAnnouncement({
      commandId: 'create-1',
      idempotencyKey: 'create-1',
      householdId: 'house-1',
      disclosure: disclosure(),
    });
    const eventId = created.kind === 'success' ? created.event?.eventId : undefined;
    await subject.advanceStatus({
      commandId: 'advance-1',
      idempotencyKey: 'advance-1',
      householdId: 'house-1',
      eventId: eventId!,
      asOfDate: '2026-07-20',
    });

    const projection = await subject.rebuildAnnual('house-1', 2026);

    expect(projection.monthlyAmounts).toHaveLength(12);
    expect(projection.monthlyAmounts).toEqual([0, 0, 0, 0, 0, 0, 1_000, 0, 0, 0, 0, 0]);
    expect(Object.keys(projection.events)).toEqual([eventId]);
    expect(projection.events[eventId!].eventId).toBe(eventId);
  });
});

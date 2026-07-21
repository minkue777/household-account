import { describe, expect, it } from "vitest";
import {
  advanceDividendEvent,
  createDividendEventId,
  upsertDividendAnnouncement,
  validateDividendStateTransition,
  type DividendEvent,
} from "../../../src/contexts/portfolio/dividends/public";

interface DividendEventView {
  eventId: string;
  sourceDisclosureId: string;
  recordDate: string;
  paymentDate: string;
  perShareAmount: number;
  status: "announced" | "fixed" | "paid";
  eligibleQuantity?: number;
  totalAmount?: number;
  aggregateVersion: number;
}

type TransitionResult =
  | { kind: "success"; event: DividendEventView }
  | { kind: "no-change"; event: DividendEventView }
  | { kind: "conflict"; code: "INVALID_DIVIDEND_STATE_TRANSITION" };

interface DividendChangedEvent {
  eventType: "DividendEventChanged.v1";
  aggregateId: string;
  aggregateVersion: number;
  status: "announced" | "fixed" | "paid";
}

export interface DividendStateTransitionContractSubject {
  upsertDisclosure(input: {
    sourceDisclosureId: string;
    recordDate: string;
    paymentDate: string;
    perShareAmount: number;
  }): Promise<DividendEventView>;
  advance(input: {
    eventId: string;
    asOfDate: string;
    eligibleQuantity?: number;
  }): Promise<TransitionResult>;
  forceTransitionForValidation(input: {
    eventId: string;
    targetStatus: "announced" | "fixed" | "paid";
  }): Promise<TransitionResult>;
  listEvents(): readonly DividendEventView[];
  recordedEvents(): readonly DividendChangedEvent[];
}

export function createSubject(): DividendStateTransitionContractSubject {
  const events = new Map<string, DividendEvent>();
  const outbox: DividendChangedEvent[] = [];

  return {
    async upsertDisclosure(input) {
      const eventId = createDividendEventId(input.sourceDisclosureId);
      const outcome = upsertDividendAnnouncement(events.get(eventId), input);
      events.set(outcome.event.eventId, outcome.event);
      outbox.push(...outcome.changedEvents);
      return outcome.event;
    },
    async advance(input) {
      const event = events.get(input.eventId);
      if (!event) throw new Error(`DividendEvent를 찾을 수 없습니다: ${input.eventId}`);

      const outcome = advanceDividendEvent(event, input);
      if (outcome.result.kind !== "conflict") {
        events.set(outcome.result.event.eventId, outcome.result.event);
      }
      outbox.push(...outcome.changedEvents);
      return outcome.result;
    },
    async forceTransitionForValidation(input) {
      const event = events.get(input.eventId);
      if (!event) throw new Error(`DividendEvent를 찾을 수 없습니다: ${input.eventId}`);

      const validation = validateDividendStateTransition(
        event.status,
        input.targetStatus,
      );
      if (validation === "conflict") {
        return {
          kind: "conflict",
          code: "INVALID_DIVIDEND_STATE_TRANSITION",
        };
      }
      return { kind: "no-change", event };
    },
    listEvents: () => [...events.values()],
    recordedEvents: () => [...outbox],
  };
}

describe("DividendEvent 상태 전이와 안정 identity 계약", () => {
  it("[T-DIV-006][DIV-003] 기준일 전에는 announced를 유지하고 기준일·지급일에 fixed·paid만 순서대로 전이한다", async () => {
    const subject = createSubject();
    const event = await subject.upsertDisclosure({
      sourceDisclosureId: "kind-disclosure-1",
      recordDate: "2026-07-10",
      paymentDate: "2026-07-20",
      perShareAmount: 100.4,
    });

    expect(
      await subject.advance({ eventId: event.eventId, asOfDate: "2026-07-09" }),
    ).toEqual({ kind: "no-change", event });
    const fixed = await subject.advance({
      eventId: event.eventId,
      asOfDate: "2026-07-10",
      eligibleQuantity: 10.55,
    });
    expect(fixed).toEqual({
      kind: "success",
      event: expect.objectContaining({
        status: "fixed",
        eligibleQuantity: 10.55,
        totalAmount: 1_059,
      }),
    });
    const paid = await subject.advance({
      eventId: event.eventId,
      asOfDate: "2026-07-20",
    });
    expect(paid).toEqual({
      kind: "success",
      event: expect.objectContaining({ status: "paid", totalAmount: 1_059 }),
    });
    expect(subject.recordedEvents().map(({ status }) => status)).toEqual([
      "announced",
      "fixed",
      "paid",
    ]);
  });

  it("[T-DIV-006][DIV-003] 같은 안정 공시 ID의 반복 수집은 같은 Event 하나로 수렴한다", async () => {
    const subject = createSubject();
    const input = {
      sourceDisclosureId: "kind-disclosure-1",
      recordDate: "2026-07-10",
      paymentDate: "2026-07-20",
      perShareAmount: 100,
    };

    const first = await subject.upsertDisclosure(input);
    const replay = await subject.upsertDisclosure(input);

    expect(replay.eventId).toBe(first.eventId);
    expect(subject.listEvents()).toEqual([first]);
  });

  it("[T-DIV-006][DIV-003] paid에서 fixed·announced로의 역전은 최종 Event를 변경하지 않는 Conflict다", async () => {
    const subject = createSubject();
    const event = await subject.upsertDisclosure({
      sourceDisclosureId: "kind-disclosure-1",
      recordDate: "2026-07-10",
      paymentDate: "2026-07-20",
      perShareAmount: 100,
    });
    await subject.advance({
      eventId: event.eventId,
      asOfDate: "2026-07-20",
      eligibleQuantity: 10,
    });
    const before = subject.listEvents();

    expect(
      await subject.forceTransitionForValidation({
        eventId: event.eventId,
        targetStatus: "fixed",
      }),
    ).toEqual({
      kind: "conflict",
      code: "INVALID_DIVIDEND_STATE_TRANSITION",
    });
    expect(subject.listEvents()).toEqual(before);
  });
});

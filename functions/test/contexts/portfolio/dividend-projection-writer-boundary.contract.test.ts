import { describe, expect, it } from "vitest";
import { createDividendProjectionWriterFixture } from "../../support/dividend-projection-writer-fixture";

interface ProjectionEventFact {
  eventId: string;
  paymentDate: string;
  totalAmount: number;
  status: "fixed" | "paid";
  aggregateVersion: number;
}

interface AnnualProjectionView {
  monthlyAmounts: readonly number[];
  events: Readonly<Record<string, ProjectionEventFact>>;
  sourceCheckpoint: string;
  freshness: "fresh" | "rebuilding";
}

type ProjectionChange =
  | {
      eventType: "DividendEventChanged.v1";
      eventId: string;
      aggregateVersion: number;
      event: ProjectionEventFact;
      checkpoint: string;
    }
  | {
      eventType: "DividendEventRemoved.v1";
      eventId: string;
      aggregateVersion: number;
      checkpoint: string;
    };

type ProjectionWriteResult =
  | { kind: "success"; value: AnnualProjectionView }
  | { kind: "already-processed"; value: AnnualProjectionView }
  | { kind: "rebuild-required"; value: AnnualProjectionView }
  | { kind: "forbidden"; code: "DIVIDEND_PROJECTION_WRITE_FORBIDDEN" };

export interface DividendProjectionWriterBoundarySubject {
  handle(change: ProjectionChange): Promise<ProjectionWriteResult>;
  attemptDirectOverwrite(input: {
    actor: "anonymous" | "member";
    projection: AnnualProjectionView;
  }): Promise<ProjectionWriteResult>;
  rebuild(canonicalEvents: readonly ProjectionEventFact[]): Promise<ProjectionWriteResult>;
  currentProjection(): AnnualProjectionView;
}

export function createSubject(seed?: {
  projection?: AnnualProjectionView;
}): DividendProjectionWriterBoundarySubject {
  return createDividendProjectionWriterFixture(seed);
}

const emptyProjection: AnnualProjectionView = {
  monthlyAmounts: Array.from({ length: 12 }, () => 0),
  events: {},
  sourceCheckpoint: "start",
  freshness: "fresh",
};

const fixed: ProjectionEventFact = {
  eventId: "event-1",
  paymentDate: "2026-07-20",
  totalAmount: 1_000,
  status: "fixed",
  aggregateVersion: 2,
};

describe("배당 Annual Projection 단일 Writer 계약", () => {
  it("[T-DIV-007][DIV-004] 같은 Event 변경을 중복 전달해도 canonical eventId 한 건과 월 합계 한 번만 반영한다", async () => {
    const subject = createSubject({ projection: emptyProjection });
    const change: ProjectionChange = {
      eventType: "DividendEventChanged.v1",
      eventId: fixed.eventId,
      aggregateVersion: fixed.aggregateVersion,
      event: fixed,
      checkpoint: "event-1:v2",
    };

    const first = await subject.handle(change);
    const duplicate = await subject.handle(change);

    expect(first).toEqual({
      kind: "success",
      value: expect.objectContaining({
        monthlyAmounts: [0, 0, 0, 0, 0, 0, 1_000, 0, 0, 0, 0, 0],
        events: { "event-1": fixed },
      }),
    });
    expect(duplicate).toEqual({
      kind: "already-processed",
      value: first.kind === "success" ? first.value : expect.anything(),
    });
    expect(subject.currentProjection()).toEqual(
      first.kind === "success" ? first.value : undefined,
    );
  });

  it("[T-DIV-007][DIV-004] version gap·역순은 임의 적용하지 않고 마지막 완성 Projection을 유지하며 rebuild를 요구한다", async () => {
    const subject = createSubject({ projection: emptyProjection });

    const result = await subject.handle({
      eventType: "DividendEventChanged.v1",
      eventId: "event-1",
      aggregateVersion: 3,
      event: { ...fixed, aggregateVersion: 3, status: "paid" },
      checkpoint: "event-1:v3",
    });

    expect(result).toEqual({
      kind: "rebuild-required",
      value: { ...emptyProjection, freshness: "rebuilding" },
    });
    expect(subject.currentProjection().events).toEqual({});
    expect(subject.currentProjection().monthlyAmounts).toEqual(
      emptyProjection.monthlyAmounts,
    );
  });

  it.each(["anonymous", "member"] as const)(
    "[T-DIV-007][DIV-004] %s 직접 overwrite는 Projection을 바꾸지 않는 Forbidden이다",
    async (actor) => {
      const subject = createSubject({ projection: emptyProjection });

      expect(
        await subject.attemptDirectOverwrite({
          actor,
          projection: {
            ...emptyProjection,
            monthlyAmounts: Array.from({ length: 12 }, () => 999_999),
          },
        }),
      ).toEqual({
        kind: "forbidden",
        code: "DIVIDEND_PROJECTION_WRITE_FORBIDDEN",
      });
      expect(subject.currentProjection()).toEqual(emptyProjection);
    },
  );

  it("[T-DIV-007][DIV-004/DIV-006] rebuild는 stale map을 merge하지 않고 현재 fixed·paid Event 전체로 교체한다", async () => {
    const staleEvent: ProjectionEventFact = {
      ...fixed,
      eventId: "cancelled-event",
      aggregateVersion: 1,
    };
    const subject = createSubject({
      projection: {
        ...emptyProjection,
        monthlyAmounts: [0, 0, 0, 0, 0, 0, 500, 0, 0, 0, 0, 0],
        events: { "cancelled-event": staleEvent },
        sourceCheckpoint: "stale",
      },
    });

    const result = await subject.rebuild([fixed]);

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        monthlyAmounts: [0, 0, 0, 0, 0, 0, 1_000, 0, 0, 0, 0, 0],
        events: { "event-1": fixed },
        freshness: "fresh",
      }),
    });
    expect(subject.currentProjection().events["cancelled-event"]).toBeUndefined();
  });
});

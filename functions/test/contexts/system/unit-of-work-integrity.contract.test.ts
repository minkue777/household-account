import { describe, expect, it } from "vitest";
import {
  createUnitOfWorkIntegrityFixture,
  type UnitOfWorkIntegrityFixtureSubject,
  type UnitOfWorkStateView,
} from "../../support/unit-of-work-integrity-fixture";

export interface UnitOfWorkIntegritySubject
  extends UnitOfWorkIntegrityFixtureSubject {}

export function createSubject(fixture: {
  callbackAttemptsBeforeCommit?: number;
  failAt?: "record" | "receipt" | "outbox";
}): UnitOfWorkIntegritySubject {
  return createUnitOfWorkIntegrityFixture(fixture);
}

const emptyState: UnitOfWorkStateView = {
  records: [],
  receipts: [],
  outboxEvents: [],
};

describe("공통 Unit of Work 무결성 계약", () => {
  it("[T-SYS-007][SYS-007] transaction callback이 재실행돼도 본문·receipt·Outbox를 원자적으로 한 번만 확정한다", async () => {
    const subject = createSubject({ callbackAttemptsBeforeCommit: 2 });

    const result = await subject.execute({
      commandId: "command-1",
      recordId: "record-1",
      value: "value",
    });

    expect(result).toEqual({ kind: "success", recordId: "record-1" });
    expect(subject.state()).toEqual({
      records: [{ recordId: "record-1", value: "value" }],
      receipts: [{ commandId: "command-1", result: "success:record-1" }],
      outboxEvents: [{ eventId: expect.any(String), type: "RecordChanged.v1" }],
    });
    expect(subject.dispatchedEventIds()).toHaveLength(1);
  });

  it.each(["record", "receipt", "outbox"] as const)(
    "[T-SYS-007][SYS-007] %s 저장 실패 시 일부 상태나 거짓 완료를 남기지 않는다",
    async (failAt) => {
      const subject = createSubject({ failAt });

      expect(
        await subject.execute({
          commandId: "command-1",
          recordId: "record-1",
          value: "value",
        }),
      ).toEqual({
        kind: "retryable-failure",
        code: "UNIT_OF_WORK_COMMIT_FAILED",
      });
      expect(subject.state()).toEqual(emptyState);
      expect(subject.dispatchedEventIds()).toEqual([]);
    },
  );

  it("[T-SYS-007][SYS-007] 같은 commandId의 같은 payload 재시도는 최초 결과만 재생한다", async () => {
    const subject = createSubject({});
    const command = {
      commandId: "command-1",
      recordId: "record-1",
      value: "value",
    };

    const first = await subject.execute(command);
    const replay = await subject.execute(command);

    expect(replay).toEqual(first);
    expect(subject.state().records).toHaveLength(1);
    expect(subject.state().receipts).toHaveLength(1);
    expect(subject.state().outboxEvents).toHaveLength(1);
    expect(subject.dispatchedEventIds()).toHaveLength(1);
  });

  it("[T-SYS-007][SYS-007] 같은 commandId의 다른 payload는 원 상태를 보존하며 충돌한다", async () => {
    const subject = createSubject({});
    await subject.execute({
      commandId: "command-1",
      recordId: "record-1",
      value: "first",
    });
    const before = subject.state();

    expect(
      await subject.execute({
        commandId: "command-1",
        recordId: "record-1",
        value: "different",
      }),
    ).toEqual({
      kind: "conflict",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
    expect(subject.state()).toEqual(before);
    expect(subject.dispatchedEventIds()).toHaveLength(1);
  });
});

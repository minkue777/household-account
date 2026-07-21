import { describe, expect, it } from "vitest";

import { createHomeConfigurationFixture } from "../../../support/home-configuration-fixture";

type SupportedHomeCardType =
  | "LOCAL_CURRENCY_BALANCE"
  | "MONTHLY_REMAINING_BUDGET"
  | "MONTHLY_EXPENSE"
  | "YEARLY_EXPENSE";

interface HomeConfigurationState {
  householdId: string;
  left: SupportedHomeCardType;
  right: SupportedHomeCardType;
  selectedLocalCurrencyType?: string;
  version: number;
}

interface HomeActorState {
  memberId: string;
  householdId: string;
  lifecycle: "active" | "removed";
}

interface HomeConfigurationReceipt {
  commandId: string;
  idempotencyKey: string;
  householdId: string;
  resultingVersion: number;
}

interface HomeConfigurationChangedEvent {
  eventType: "HomeConfigurationChanged.v1";
  householdId: string;
  aggregateVersion: number;
  left: SupportedHomeCardType;
  right: SupportedHomeCardType;
}

type RawHomeConfigurationResult =
  | {
      kind: "success";
      value: HomeConfigurationState;
      receipt: HomeConfigurationReceipt;
    }
  | {
      kind: "validation-error";
      code: "UNSUPPORTED_HOME_CARD_TYPE" | "DUPLICATE_HOME_CARD_TYPE";
    }
  | {
      kind: "conflict";
      code:
        | "HOME_CONFIGURATION_VERSION_MISMATCH"
        | "IDEMPOTENCY_PAYLOAD_MISMATCH";
    }
  | {
      kind: "forbidden";
      code: "INACTIVE_MEMBER" | "HOUSEHOLD_MEMBERSHIP_REQUIRED";
    };

interface HomeCommandBoundaryFixture {
  configuration: HomeConfigurationState;
  actors: readonly HomeActorState[];
}

/** 설정 transport의 unknown 입력·인가·멱등 UoW 공개 계약입니다. */
export interface HomeCommandBoundarySubject {
  saveRaw(input: {
    actor: { memberId: string; householdId: string };
    commandId: string;
    idempotencyKey: string;
    expectedVersion: number;
    left: unknown;
    right: unknown;
  }): Promise<RawHomeConfigurationResult>;
  query(actor: {
    memberId: string;
    householdId: string;
  }): Promise<
    | { kind: "success"; value: HomeConfigurationState }
    | { kind: "forbidden" }
  >;
  receipts(): readonly HomeConfigurationReceipt[];
  recordedEvents(): readonly HomeConfigurationChangedEvent[];
}

export function createSubject(
  fixture: HomeCommandBoundaryFixture,
): HomeCommandBoundarySubject {
  const driver = createHomeConfigurationFixture({
    configuration: { ...fixture.configuration, source: "SAVED" },
    actors: fixture.actors,
  });
  return {
    async saveRaw(input) {
      const result = await driver.application.saveRaw(input);
      if (result.kind === "validation-error") {
        if (result.code === "LOCAL_CURRENCY_TYPE_NOT_AVAILABLE") {
          throw new Error("HOME_COMMAND_RESULT_CONTRACT_VIOLATION");
        }
        return { kind: "validation-error", code: result.code };
      }
      if (result.kind === "conflict" || result.kind === "forbidden") {
        return { ...result };
      }
      const { source: _source, ...value } = result.value;
      return { ...result, value };
    },
    async query(actor) {
      const result = await driver.application.query(actor);
      if (result.kind === "forbidden") return { kind: "forbidden" };
      const { source: _source, ...value } = result.value;
      return { kind: "success", value };
    },
    receipts: driver.receipts,
    recordedEvents: driver.events,
  };
}

const initial: HomeConfigurationState = {
  householdId: "house-1",
  left: "LOCAL_CURRENCY_BALANCE",
  right: "MONTHLY_REMAINING_BUDGET",
  selectedLocalCurrencyType: "gyeonggi",
  version: 7,
};

const actors: readonly HomeActorState[] = [
  { memberId: "member-active", householdId: "house-1", lifecycle: "active" },
  { memberId: "member-removed", householdId: "house-1", lifecycle: "removed" },
  { memberId: "member-foreign", householdId: "house-2", lifecycle: "active" },
];

const activeActor = { memberId: "member-active", householdId: "house-1" };

describe("Home configuration command 보안·멱등 계약", () => {
  it.each(["UNKNOWN_CARD", "", null, 123])(
    "[T-HOME-002][HOME-004] 지원하지 않는 raw card type %#은 write 0건인 ValidationError다",
    async (unknownCard) => {
      const subject = createSubject({ configuration: initial, actors });

      expect(
        await subject.saveRaw({
          actor: activeActor,
          commandId: "save-unknown",
          idempotencyKey: "save-unknown",
          expectedVersion: 7,
          left: unknownCard,
          right: "YEARLY_EXPENSE",
        }),
      ).toEqual({
        kind: "validation-error",
        code: "UNSUPPORTED_HOME_CARD_TYPE",
      });
      expect(await subject.query(activeActor)).toEqual({
        kind: "success",
        value: initial,
      });
      expect(subject.receipts()).toEqual([]);
      expect(subject.recordedEvents()).toEqual([]);
    },
  );

  it("[T-HOME-002][HOME-004] 같은 idempotency key·같은 payload는 최초 공개 결과를 재생하고 receipt·Event를 중복하지 않는다", async () => {
    const subject = createSubject({ configuration: initial, actors });
    const command = {
      actor: activeActor,
      commandId: "save-home-1",
      idempotencyKey: "save-home-1",
      expectedVersion: 7,
      left: "MONTHLY_EXPENSE",
      right: "YEARLY_EXPENSE",
    };

    const first = await subject.saveRaw(command);
    const replay = await subject.saveRaw(command);

    expect(first).toEqual({
      kind: "success",
      value: {
        ...initial,
        left: "MONTHLY_EXPENSE",
        right: "YEARLY_EXPENSE",
        version: 8,
      },
      receipt: {
        commandId: "save-home-1",
        idempotencyKey: "save-home-1",
        householdId: "house-1",
        resultingVersion: 8,
      },
    });
    expect(replay).toEqual(first);
    expect(await subject.query(activeActor)).toEqual({
      kind: "success",
      value: first.kind === "success" ? first.value : initial,
    });
    expect(subject.receipts()).toHaveLength(1);
    expect(subject.recordedEvents()).toEqual([
      {
        eventType: "HomeConfigurationChanged.v1",
        householdId: "house-1",
        aggregateVersion: 8,
        left: "MONTHLY_EXPENSE",
        right: "YEARLY_EXPENSE",
      },
    ]);
  });

  it("[T-HOME-002][HOME-004] 같은 idempotency key의 다른 payload는 기존 구성을 유지하는 Conflict다", async () => {
    const subject = createSubject({ configuration: initial, actors });
    await subject.saveRaw({
      actor: activeActor,
      commandId: "save-home-1",
      idempotencyKey: "save-home-1",
      expectedVersion: 7,
      left: "MONTHLY_EXPENSE",
      right: "YEARLY_EXPENSE",
    });
    const afterFirst = await subject.query(activeActor);

    expect(
      await subject.saveRaw({
        actor: activeActor,
        commandId: "save-home-2",
        idempotencyKey: "save-home-1",
        expectedVersion: 8,
        left: "YEARLY_EXPENSE",
        right: "MONTHLY_REMAINING_BUDGET",
      }),
    ).toEqual({
      kind: "conflict",
      code: "IDEMPOTENCY_PAYLOAD_MISMATCH",
    });
    expect(await subject.query(activeActor)).toEqual(afterFirst);
    expect(subject.receipts()).toHaveLength(1);
    expect(subject.recordedEvents()).toHaveLength(1);
  });

  it.each([
    {
      label: "removed member",
      actor: { memberId: "member-removed", householdId: "house-1" },
      code: "INACTIVE_MEMBER",
    },
    {
      label: "타 가구 member를 현재 가구 Actor로 위장",
      actor: { memberId: "member-foreign", householdId: "house-1" },
      code: "HOUSEHOLD_MEMBERSHIP_REQUIRED",
    },
    {
      label: "등록되지 않은 member",
      actor: { memberId: "member-unknown", householdId: "house-1" },
      code: "HOUSEHOLD_MEMBERSHIP_REQUIRED",
    },
  ] as const)(
    "[T-HOME-002][HOME-004] $label는 공유 설정을 읽거나 변경할 수 없다",
    async ({ actor, code }) => {
      const subject = createSubject({ configuration: initial, actors });

      expect(
        await subject.saveRaw({
          actor,
          commandId: `save-${actor.memberId}`,
          idempotencyKey: `save-${actor.memberId}`,
          expectedVersion: 7,
          left: "MONTHLY_EXPENSE",
          right: "YEARLY_EXPENSE",
        }),
      ).toEqual({ kind: "forbidden", code });
      expect(await subject.query(actor)).toEqual({ kind: "forbidden" });
      expect(subject.receipts()).toEqual([]);
      expect(subject.recordedEvents()).toEqual([]);
      expect(await subject.query(activeActor)).toEqual({
        kind: "success",
        value: initial,
      });
    },
  );

  it("[T-HOME-002][HOME-004] raw 입력의 중복 카드와 stale version은 모두 write 없이 거부한다", async () => {
    const subject = createSubject({ configuration: initial, actors });

    expect(
      await subject.saveRaw({
        actor: activeActor,
        commandId: "duplicate",
        idempotencyKey: "duplicate",
        expectedVersion: 7,
        left: "MONTHLY_EXPENSE",
        right: "MONTHLY_EXPENSE",
      }),
    ).toEqual({ kind: "validation-error", code: "DUPLICATE_HOME_CARD_TYPE" });
    expect(
      await subject.saveRaw({
        actor: activeActor,
        commandId: "stale",
        idempotencyKey: "stale",
        expectedVersion: 6,
        left: "MONTHLY_EXPENSE",
        right: "YEARLY_EXPENSE",
      }),
    ).toEqual({ kind: "conflict", code: "HOME_CONFIGURATION_VERSION_MISMATCH" });
    expect(subject.receipts()).toEqual([]);
    expect(subject.recordedEvents()).toEqual([]);
  });
});

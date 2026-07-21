import { describe, expect, it } from "vitest";

import { createHomeConfigurationFixture } from "../../../support/home-configuration-fixture";

type HomeCardType =
  | "LOCAL_CURRENCY_BALANCE"
  | "MONTHLY_REMAINING_BUDGET"
  | "MONTHLY_EXPENSE"
  | "YEARLY_EXPENSE";

interface ActorContext {
  householdId: string;
  memberId: string;
}

interface HomeConfigurationView {
  left: HomeCardType;
  right: HomeCardType;
  selectedLocalCurrencyType?: string;
  version: number;
  source: "SAVED" | "DEFAULT" | "LEGACY";
}

interface HomeCommandEnvelope extends ActorContext {
  commandId: string;
  idempotencyKey: string;
}

type GetHomeConfigurationResult =
  | { kind: "success"; value: HomeConfigurationView }
  | { kind: "forbidden" };

type SaveHomeConfigurationResult =
  | { kind: "success"; value: HomeConfigurationView }
  | {
      kind: "validation-error";
      code: "DUPLICATE_HOME_CARD_TYPE" | "UNSUPPORTED_HOME_CARD_TYPE";
    }
  | {
      kind: "conflict";
      code:
        | "HOME_CONFIGURATION_VERSION_MISMATCH"
        | "IDEMPOTENCY_PAYLOAD_MISMATCH";
    }
  | { kind: "forbidden" };

type SelectHomeLocalCurrencyResult =
  | { kind: "success"; value: HomeConfigurationView }
  | { kind: "validation-error"; code: "LOCAL_CURRENCY_TYPE_NOT_AVAILABLE" }
  | {
      kind: "conflict";
      code:
        | "HOME_CONFIGURATION_VERSION_MISMATCH"
        | "IDEMPOTENCY_PAYLOAD_MISMATCH";
    }
  | { kind: "forbidden" };

interface HomePreferencesFixture {
  configuration?: HomeConfigurationView;
  activeMemberIds?: readonly string[];
  availableLocalCurrencyTypes?: readonly string[];
}

/**
 * Home Preferences 모듈이 외부에 제공하는 Query·Command 계약입니다.
 * 테스트 driver의 fixture는 저장 구현을 노출하지 않고 시작 사실만 주입합니다.
 */
export interface HomeConfigurationSubject {
  getConfiguration(
    actor: ActorContext,
  ): Promise<GetHomeConfigurationResult>;
  saveConfiguration(input: {
    envelope: HomeCommandEnvelope;
    left: HomeCardType;
    right: HomeCardType;
    expectedVersion: number;
  }): Promise<SaveHomeConfigurationResult>;
  selectLocalCurrency(input: {
    envelope: HomeCommandEnvelope;
    localCurrencyType: string;
    expectedVersion: number;
  }): Promise<SelectHomeLocalCurrencyResult>;
}

export function createSubject(
  fixture: HomePreferencesFixture = {},
): HomeConfigurationSubject {
  const driver = createHomeConfigurationFixture({
    configuration:
      fixture.configuration === undefined
        ? undefined
        : { householdId: "house-1", ...fixture.configuration },
    actors: (fixture.activeMemberIds ?? []).map((memberId) => ({
      memberId,
      householdId: "house-1",
      lifecycle: "active" as const,
    })),
    availableLocalCurrencyTypes: fixture.availableLocalCurrencyTypes,
  });
  return {
    async getConfiguration(actor) {
      const result = await driver.application.query(actor);
      if (result.kind === "forbidden") return { kind: "forbidden" };
      const { householdId: _householdId, ...value } = result.value;
      return { kind: "success", value };
    },
    async saveConfiguration(input) {
      const result = await driver.application.saveRaw({
        actor: input.envelope,
        commandId: input.envelope.commandId,
        idempotencyKey: input.envelope.idempotencyKey,
        expectedVersion: input.expectedVersion,
        left: input.left,
        right: input.right,
      });
      if (result.kind === "success") {
        const { householdId: _householdId, ...value } = result.value;
        return { kind: "success", value };
      }
      if (result.kind === "validation-error") {
        if (result.code === "LOCAL_CURRENCY_TYPE_NOT_AVAILABLE") {
          throw new Error("CARD_CONFIGURATION_RESULT_CONTRACT_VIOLATION");
        }
        return { kind: "validation-error", code: result.code };
      }
      if (result.kind === "conflict") return { ...result };
      return { kind: "forbidden" };
    },
    async selectLocalCurrency(input) {
      const result = await driver.application.selectLocalCurrency({
        actor: input.envelope,
        commandId: input.envelope.commandId,
        idempotencyKey: input.envelope.idempotencyKey,
        expectedVersion: input.expectedVersion,
        localCurrencyType: input.localCurrencyType,
      });
      if (result.kind === "success") {
        const { householdId: _householdId, ...value } = result.value;
        return { kind: "success", value };
      }
      if (result.kind === "validation-error") {
        if (result.code !== "LOCAL_CURRENCY_TYPE_NOT_AVAILABLE") {
          throw new Error("LOCAL_CURRENCY_RESULT_CONTRACT_VIOLATION");
        }
        return { kind: "validation-error", code: result.code };
      }
      if (result.kind === "conflict") return { ...result };
      return { kind: "forbidden" };
    },
  };
}

const actor = (memberId: string): ActorContext => ({
  householdId: "house-1",
  memberId,
});

const envelope = (
  memberId: string,
  commandId: string,
): HomeCommandEnvelope => ({
  ...actor(memberId),
  commandId,
  idempotencyKey: commandId,
});

const saved = (
  overrides: Partial<HomeConfigurationView> = {},
): HomeConfigurationView => ({
  left: "LOCAL_CURRENCY_BALANCE",
  right: "MONTHLY_REMAINING_BUDGET",
  selectedLocalCurrencyType: "gyeonggi",
  version: 7,
  source: "SAVED",
  ...overrides,
});

describe("Home Preferences 공유 구성 공개 계약", () => {
  it("[T-HOME-002][HOME-001/HOME-004/DEC-061] 저장값이 없으면 서로 다른 기본 왼쪽·오른쪽 카드를 반환한다", async () => {
    const result = await createSubject({
      activeMemberIds: ["member-a"],
    }).getConfiguration(actor("member-a"));

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        left: "LOCAL_CURRENCY_BALANCE",
        right: "MONTHLY_REMAINING_BUDGET",
        source: "DEFAULT",
      }),
    });
  });

  it("[T-HOME-002][HOME-004/DEC-061] 활성 가구원이 왼쪽·오른쪽의 서로 다른 유형과 순서를 공유 설정으로 저장한다", async () => {
    const subject = createSubject({
      configuration: saved(),
      activeMemberIds: ["member-a", "member-b"],
    });

    const result = await subject.saveConfiguration({
      envelope: envelope("member-b", "save-by-member-b"),
      left: "MONTHLY_EXPENSE",
      right: "YEARLY_EXPENSE",
      expectedVersion: 7,
    });

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        left: "MONTHLY_EXPENSE",
        right: "YEARLY_EXPENSE",
        version: 8,
        source: "SAVED",
      }),
    });
    expect(await subject.getConfiguration(actor("member-a"))).toEqual({
      kind: "success",
      value: expect.objectContaining({
        left: "MONTHLY_EXPENSE",
        right: "YEARLY_EXPENSE",
        version: 8,
      }),
    });
  });

  it("[T-HOME-002][HOME-004/DEC-061] 같은 유형을 양쪽에 새로 저장하면 write 없이 기존 구성을 유지한다", async () => {
    const subject = createSubject({
      configuration: saved(),
      activeMemberIds: ["member-a"],
    });

    const result = await subject.saveConfiguration({
      envelope: envelope("member-a", "duplicate-cards"),
      left: "MONTHLY_EXPENSE",
      right: "MONTHLY_EXPENSE",
      expectedVersion: 7,
    });

    expect(result).toEqual({
      kind: "validation-error",
      code: "DUPLICATE_HOME_CARD_TYPE",
    });
    expect(await subject.getConfiguration(actor("member-a"))).toEqual({
      kind: "success",
      value: saved(),
    });
  });

  it("[T-HOME-002][HOME-004/DEC-061] 기존 legacy 중복 구성은 자동 보정하지 않고 읽되 동일한 중복 신규 저장은 거부한다", async () => {
    const legacy = saved({
      left: "MONTHLY_EXPENSE",
      right: "MONTHLY_EXPENSE",
      version: 3,
      source: "LEGACY",
    });
    const subject = createSubject({
      configuration: legacy,
      activeMemberIds: ["member-a"],
    });

    expect(await subject.getConfiguration(actor("member-a"))).toEqual({
      kind: "success",
      value: legacy,
    });
    expect(
      await subject.saveConfiguration({
        envelope: envelope("member-a", "legacy-duplicate-write"),
        left: "MONTHLY_EXPENSE",
        right: "MONTHLY_EXPENSE",
        expectedVersion: 3,
      }),
    ).toEqual({
      kind: "validation-error",
      code: "DUPLICATE_HOME_CARD_TYPE",
    });
    expect(await subject.getConfiguration(actor("member-a"))).toEqual({
      kind: "success",
      value: legacy,
    });
  });

  it("[T-HOME-002][HOME-004/DEC-061] legacy 중복 구성도 다음 유효 저장부터 서로 다른 두 유형으로 전환할 수 있다", async () => {
    const subject = createSubject({
      configuration: saved({
        left: "MONTHLY_EXPENSE",
        right: "MONTHLY_EXPENSE",
        version: 3,
        source: "LEGACY",
      }),
      activeMemberIds: ["member-a"],
    });

    const result = await subject.saveConfiguration({
      envelope: envelope("member-a", "replace-legacy-duplicate"),
      left: "MONTHLY_EXPENSE",
      right: "YEARLY_EXPENSE",
      expectedVersion: 3,
    });

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        left: "MONTHLY_EXPENSE",
        right: "YEARLY_EXPENSE",
        version: 4,
        source: "SAVED",
      }),
    });
  });

  it("[T-HOME-002][HOME-004/DEC-061] 같은 expectedVersion으로 동시에 저장하면 정확히 하나만 성공하고 loser는 Conflict다", async () => {
    const subject = createSubject({
      configuration: saved(),
      activeMemberIds: ["member-a", "member-b"],
    });

    const results = await Promise.all([
      subject.saveConfiguration({
        envelope: envelope("member-a", "concurrent-a"),
        left: "MONTHLY_EXPENSE",
        right: "YEARLY_EXPENSE",
        expectedVersion: 7,
      }),
      subject.saveConfiguration({
        envelope: envelope("member-b", "concurrent-b"),
        left: "YEARLY_EXPENSE",
        right: "MONTHLY_REMAINING_BUDGET",
        expectedVersion: 7,
      }),
    ]);

    expect(results.map(({ kind }) => kind).sort()).toEqual([
      "conflict",
      "success",
    ]);
    expect(results.find(({ kind }) => kind === "conflict")).toEqual({
      kind: "conflict",
      code: "HOME_CONFIGURATION_VERSION_MISMATCH",
    });

    const winner = results.find(
      (result): result is Extract<SaveHomeConfigurationResult, { kind: "success" }> =>
        result.kind === "success",
    );
    expect(winner).toBeDefined();
    if (!winner) {
      throw new Error("동시 저장 계약상 success 결과가 하나 있어야 합니다.");
    }
    expect(await subject.getConfiguration(actor("member-a"))).toEqual({
      kind: "success",
      value: winner.value,
    });
  });

  it("[T-HOME-002][HOME-002/HOME-004/DEC-061] 카드 구성 저장은 선택 지역화폐를 바꾸지 않는다", async () => {
    const subject = createSubject({
      configuration: saved({ selectedLocalCurrencyType: "daejeon" }),
      activeMemberIds: ["member-a"],
      availableLocalCurrencyTypes: ["gyeonggi", "daejeon"],
    });

    const result = await subject.saveConfiguration({
      envelope: envelope("member-a", "save-cards-only"),
      left: "YEARLY_EXPENSE",
      right: "LOCAL_CURRENCY_BALANCE",
      expectedVersion: 7,
    });

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        left: "YEARLY_EXPENSE",
        right: "LOCAL_CURRENCY_BALANCE",
        selectedLocalCurrencyType: "daejeon",
      }),
    });
  });

  it("[T-HOME-002][HOME-002/HOME-004/DEC-061] 지역화폐 선택 저장은 왼쪽·오른쪽 카드 구성을 바꾸지 않는다", async () => {
    const subject = createSubject({
      configuration: saved({
        left: "MONTHLY_EXPENSE",
        right: "YEARLY_EXPENSE",
      }),
      activeMemberIds: ["member-a"],
      availableLocalCurrencyTypes: ["gyeonggi", "daejeon"],
    });

    const result = await subject.selectLocalCurrency({
      envelope: envelope("member-a", "select-currency-only"),
      localCurrencyType: "daejeon",
      expectedVersion: 7,
    });

    expect(result).toEqual({
      kind: "success",
      value: expect.objectContaining({
        left: "MONTHLY_EXPENSE",
        right: "YEARLY_EXPENSE",
        selectedLocalCurrencyType: "daejeon",
        version: 8,
      }),
    });
  });

  it("[T-HOME-002][HOME-002] 보유하지 않은 지역화폐 선택은 기존 구성 전체를 유지한다", async () => {
    const subject = createSubject({
      configuration: saved(),
      activeMemberIds: ["member-a"],
      availableLocalCurrencyTypes: ["gyeonggi"],
    });

    expect(
      await subject.selectLocalCurrency({
        envelope: envelope("member-a", "invalid-currency"),
        localCurrencyType: "daejeon",
        expectedVersion: 7,
      }),
    ).toEqual({
      kind: "validation-error",
      code: "LOCAL_CURRENCY_TYPE_NOT_AVAILABLE",
    });
    expect(await subject.getConfiguration(actor("member-a"))).toEqual({
      kind: "success",
      value: saved(),
    });
  });

  it("[T-HOME-002][HOME-002] stale version 지역화폐 선택은 기존 선택과 카드 구성을 유지한다", async () => {
    const subject = createSubject({
      configuration: saved(),
      activeMemberIds: ["member-a"],
      availableLocalCurrencyTypes: ["gyeonggi", "daejeon"],
    });

    expect(
      await subject.selectLocalCurrency({
        envelope: envelope("member-a", "stale-currency"),
        localCurrencyType: "daejeon",
        expectedVersion: 6,
      }),
    ).toEqual({
      kind: "conflict",
      code: "HOME_CONFIGURATION_VERSION_MISMATCH",
    });
    expect(await subject.getConfiguration(actor("member-a"))).toEqual({
      kind: "success",
      value: saved(),
    });
  });
});

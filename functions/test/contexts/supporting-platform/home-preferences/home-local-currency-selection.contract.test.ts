import { describe, expect, it } from "vitest";

import { createHomeLocalCurrencySelectionFixture } from "../../../support/home-local-currency-selection-fixture";

interface LocalCurrencyCandidate {
  type: string;
  displayName: string;
  balanceInWon: number;
  updatedAt: string;
}

interface HomeLocalCurrencyFixture {
  candidates: readonly LocalCurrencyCandidate[];
  selectedType?: string;
  version?: number;
}

type LocalCurrencyCardState =
  | { kind: "READY"; type: string; amountInWon: number }
  | { kind: "NO_DATA"; reason: "LOCAL_CURRENCY_SELECTION_REQUIRED" };

type SelectResult =
  | { kind: "success"; selectedType: string; version: number }
  | { kind: "validation-error"; code: "LOCAL_CURRENCY_TYPE_NOT_AVAILABLE" }
  | { kind: "conflict"; code: "HOME_CONFIGURATION_VERSION_MISMATCH" };

interface DetailNavigation {
  intent: "open-local-currency-detail";
  selectedType: string;
  capabilities: {
    canSelectAllTypes: false;
    canSwitchTypeInsideDetail: false;
  };
}

export interface HomeLocalCurrencySelectionSubject {
  getCard(): Promise<LocalCurrencyCardState>;
  select(input: {
    localCurrencyType: string;
    expectedVersion: number;
  }): Promise<SelectResult>;
  openSelectedDetail(): Promise<DetailNavigation>;
  getPersistedSelection(): Promise<{ selectedType?: string; version: number }>;
}

export function createSubject(
  fixture: HomeLocalCurrencyFixture,
): HomeLocalCurrencySelectionSubject {
  return createHomeLocalCurrencySelectionFixture(fixture);
}

const currency = (
  type: string,
  balanceInWon: number,
  updatedAt: string,
): LocalCurrencyCandidate => ({
  type,
  displayName: type,
  balanceInWon,
  updatedAt,
});

describe("Home Preferences 지역화폐 선택 계약", () => {
  it("[T-HOME-004][HOME-002] 선택값 없이 정확히 한 유형만 있으면 그 유형을 조건부 자동 선택한다", async () => {
    const subject = createSubject({
      candidates: [currency("gyeonggi", 30_000, "2026-07-20T09:00:00+09:00")],
      version: 4,
    });

    expect(await subject.getCard()).toEqual({
      kind: "READY",
      type: "gyeonggi",
      amountInWon: 30_000,
    });
    expect(await subject.getPersistedSelection()).toEqual({
      selectedType: "gyeonggi",
      version: 5,
    });
  });

  it("[T-HOME-004][HOME-002] 처음부터 여러 유형인데 선택값이 없으면 최신 또는 첫 항목을 임의 선택하지 않는다", async () => {
    const subject = createSubject({
      candidates: [
        currency("gyeonggi", 30_000, "2026-07-19T09:00:00+09:00"),
        currency("daejeon", 50_000, "2026-07-20T09:00:00+09:00"),
      ],
      version: 4,
    });

    expect(await subject.getCard()).toEqual({
      kind: "NO_DATA",
      reason: "LOCAL_CURRENCY_SELECTION_REQUIRED",
    });
    expect(await subject.getPersistedSelection()).toEqual({ version: 4 });
  });

  it("[T-HOME-004][HOME-002] 저장된 선택은 다른 유형이 추가되거나 더 최근에 갱신되어도 유지한다", async () => {
    const subject = createSubject({
      candidates: [
        currency("gyeonggi", 90_000, "2026-07-20T11:00:00+09:00"),
        currency("daejeon", 20_000, "2026-07-19T09:00:00+09:00"),
      ],
      selectedType: "daejeon",
      version: 8,
    });

    expect(await subject.getCard()).toEqual({
      kind: "READY",
      type: "daejeon",
      amountInWon: 20_000,
    });
    expect(await subject.getPersistedSelection()).toEqual({
      selectedType: "daejeon",
      version: 8,
    });
  });

  it("[T-HOME-004][HOME-002] 보유하지 않은 유형은 write 없이 거부한다", async () => {
    const subject = createSubject({
      candidates: [currency("gyeonggi", 30_000, "2026-07-20T09:00:00+09:00")],
      selectedType: "gyeonggi",
      version: 3,
    });

    expect(
      await subject.select({ localCurrencyType: "daejeon", expectedVersion: 3 }),
    ).toEqual({
      kind: "validation-error",
      code: "LOCAL_CURRENCY_TYPE_NOT_AVAILABLE",
    });
    expect(await subject.getPersistedSelection()).toEqual({
      selectedType: "gyeonggi",
      version: 3,
    });
  });

  it("[T-HOME-004][HOME-002] stale version 선택은 기존 선택을 유지하고 Conflict로 거부한다", async () => {
    const subject = createSubject({
      candidates: [
        currency("gyeonggi", 30_000, "2026-07-20T09:00:00+09:00"),
        currency("daejeon", 20_000, "2026-07-20T09:00:00+09:00"),
      ],
      selectedType: "gyeonggi",
      version: 9,
    });

    expect(
      await subject.select({ localCurrencyType: "daejeon", expectedVersion: 8 }),
    ).toEqual({
      kind: "conflict",
      code: "HOME_CONFIGURATION_VERSION_MISMATCH",
    });
    expect(await subject.getPersistedSelection()).toEqual({
      selectedType: "gyeonggi",
      version: 9,
    });
  });

  it("[T-HOME-004][HOME-002] 현재 보유 유형의 명시적 선택은 version을 증가시키고 이후 카드에 반영한다", async () => {
    const subject = createSubject({
      candidates: [
        currency("gyeonggi", 30_000, "2026-07-20T09:00:00+09:00"),
        currency("daejeon", 20_000, "2026-07-20T09:00:00+09:00"),
      ],
      selectedType: "gyeonggi",
      version: 2,
    });

    expect(
      await subject.select({ localCurrencyType: "daejeon", expectedVersion: 2 }),
    ).toEqual({ kind: "success", selectedType: "daejeon", version: 3 });
    expect(await subject.getCard()).toEqual({
      kind: "READY",
      type: "daejeon",
      amountInWon: 20_000,
    });
  });

  it("[T-HOME-004][HOME-002] 저장된 유형이 더 이상 후보가 아니면 다른 유형으로 임의 전환하지 않는다", async () => {
    const subject = createSubject({
      candidates: [currency("gyeonggi", 30_000, "2026-07-20T09:00:00+09:00")],
      selectedType: "retired",
      version: 2,
    });

    expect(await subject.getCard()).toEqual({
      kind: "NO_DATA",
      reason: "LOCAL_CURRENCY_SELECTION_REQUIRED",
    });
    expect(await subject.getPersistedSelection()).toEqual({
      selectedType: "retired",
      version: 2,
    });
  });

  it("[T-HOME-004][HOME-002/DEC-057] 상세 진입은 카드가 표시한 한 유형만 전달하고 전체·전환 control을 노출하지 않는다", async () => {
    const navigation = await createSubject({
      candidates: [
        currency("gyeonggi", 30_000, "2026-07-20T09:00:00+09:00"),
        currency("daejeon", 20_000, "2026-07-20T09:00:00+09:00"),
      ],
      selectedType: "daejeon",
      version: 3,
    }).openSelectedDetail();

    expect(navigation).toEqual({
      intent: "open-local-currency-detail",
      selectedType: "daejeon",
      capabilities: {
        canSelectAllTypes: false,
        canSwitchTypeInsideDetail: false,
      },
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  createAssetCreationDriver,
  type AssetCreationDriver,
  type AssetCreationFixture,
  type CreateAssetCommand,
} from "../../support/asset-creation-driver";

export interface AssetCreationContractSubject extends AssetCreationDriver {}

export function createSubject(
  fixture: AssetCreationFixture = {},
): AssetCreationContractSubject {
  return createAssetCreationDriver(fixture);
}

function validCommand(
  overrides: Partial<CreateAssetCommand> = {},
): CreateAssetCommand {
  return {
    householdId: "house-1",
    name: "자산",
    type: "savings",
    ownerRef: { kind: "household" },
    currency: "KRW",
    currentBalance: 10_000,
    memo: "",
    order: 0,
    ...overrides,
  };
}

describe("Portfolio 자산 생성 DTO 계약", () => {
  it.each([
    ["savings", "deposit"],
    ["stock", undefined],
    ["crypto", undefined],
    ["property", undefined],
    ["gold", "physical"],
    ["loan", "mortgage"],
  ] as const)(
    "[T-AST-007][AST-001] 지원 자산 유형 %s와 허용 세부 유형을 손실 없이 생성한다",
    async (type, subType) => {
      const subject = createSubject({
        ownerProfiles: [
          {
            profileId: "profile-member",
            householdId: "house-1",
            lifecycle: "active",
          },
        ],
      });

      const result = await subject.create(
        validCommand({
          name: "  테스트 자산  ",
          type,
          subType,
          ownerRef: { kind: "profile", profileId: "profile-member" },
          currentBalance: 10_000,
          memo: "  장기 보유  ",
          order: 3,
        }),
      );

      expect(result).toEqual({
        kind: "success",
        value: expect.objectContaining({
          schemaVersion: 1,
          householdId: "house-1",
          name: "테스트 자산",
          type,
          ...(subType === undefined ? {} : { subType }),
          ownerRef: { kind: "profile", profileId: "profile-member" },
          currency: "KRW",
          currentBalance: 10_000,
          memo: "장기 보유",
          order: 3,
          lifecycleState: "active",
          aggregateVersion: 1,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        }),
      });
      expect(subject.listAssets()).toEqual([
        result.kind === "success" ? result.value : undefined,
      ]);
      expect(subject.recordedEvents()).toEqual([
        {
          eventType: "AssetValuationChanged.v1",
          assetId:
            result.kind === "success" ? result.value.assetId : expect.any(String),
          assetType: type,
          ownerRef: { kind: "profile", profileId: "profile-member" },
          lifecycleState: "active",
          previousSignedBalance: 0,
          currentSignedBalance: type === "loan" ? -10_000 : 10_000,
          valuationAsOf: expect.any(String),
          reason: "asset-created",
          aggregateVersion: 1,
        },
      ]);
    },
  );

  it("[T-AST-007][AST-001/AST-009] 공동 명의 USD 0원 자산도 유효한 값 그대로 생성한다", async () => {
    const subject = createSubject();

    const result = await subject.create(
      validCommand({
        type: "stock",
        ownerRef: { kind: "household" },
        currency: "USD",
        currentBalance: 0,
      }),
    );

    expect(result).toMatchObject({
      kind: "success",
      value: {
        householdId: "house-1",
        type: "stock",
        ownerRef: { kind: "household" },
        currency: "USD",
        currentBalance: 0,
      },
    });
    expect(subject.recordedEvents()).toEqual([
      expect.objectContaining({
        currentSignedBalance: 0,
        ownerRef: { kind: "household" },
      }),
    ]);
  });

  it.each([
    ["빈 이름", { name: "   " }, "ASSET_NAME_REQUIRED"],
    ["NaN 금액", { currentBalance: Number.NaN }, "INVALID_MONEY"],
    ["Infinity 금액", { currentBalance: Number.POSITIVE_INFINITY }, "INVALID_MONEY"],
    ["음수 금액", { currentBalance: -1 }, "INVALID_MONEY"],
    ["소수 금액", { currentBalance: 0.5 }, "INVALID_MONEY"],
    ["숫자 문자열", { currentBalance: "10000" }, "INVALID_MONEY"],
    ["지원하지 않는 유형", { type: "insurance" }, "INVALID_ASSET_TYPE"],
    ["memberId 문자열 owner", { ownerRef: "member-1" }, "INVALID_OWNER_REF"],
    [
      "존재하지 않는 profile",
      { ownerRef: { kind: "profile", profileId: "missing" } },
      "INVALID_OWNER_REF",
    ],
  ] as const)(
    "[T-AST-007][AST-001/AST-009] %s 입력은 0원·기본값으로 보정하지 않고 거부한다",
    async (_label, overrides, expectedCode) => {
      const subject = createSubject();
      const result = await subject.create(validCommand(overrides));

      expect(result).toEqual({
        kind: "validation-error",
        code: expectedCode,
      });
      expect(subject.listAssets()).toEqual([]);
      expect(subject.recordedEvents()).toEqual([]);
    },
  );

  it.each([
    ["지원하지 않는 통화", { currency: "BTC" }, "INVALID_CURRENCY"],
    ["NaN 순서", { order: Number.NaN }, "INVALID_ORDER_SET"],
    ["Infinity 순서", { order: Number.POSITIVE_INFINITY }, "INVALID_ORDER_SET"],
    ["음수 순서", { order: -1 }, "INVALID_ORDER_SET"],
    ["소수 순서", { order: 0.5 }, "INVALID_ORDER_SET"],
    ["문자열 순서", { order: "1" }, "INVALID_ORDER_SET"],
  ] as const)(
    "[T-AST-007][AST-001] %s 입력은 값 손실 없이 typed ValidationError로 거부한다",
    async (_label, overrides, expectedCode) => {
      const subject = createSubject();

      expect(await subject.create(validCommand(overrides))).toEqual({
        kind: "validation-error",
        code: expectedCode,
      });
      expect(subject.listAssets()).toEqual([]);
      expect(subject.recordedEvents()).toEqual([]);
    },
  );

  it.each([
    ["예적금에 금 세부 유형", { type: "savings", subType: "physical" }],
    ["주식에 예금 세부 유형", { type: "stock", subType: "deposit" }],
    ["빈 세부 유형", { type: "loan", subType: "" }],
  ] as const)(
    "[T-AST-007][AST-001] %s은 부모 유형에 맞지 않아 거부한다",
    async (_label, overrides) => {
      const subject = createSubject();

      expect(await subject.create(validCommand(overrides))).toEqual({
        kind: "validation-error",
        code: "INVALID_ASSET_SUBTYPE",
      });
      expect(subject.listAssets()).toEqual([]);
      expect(subject.recordedEvents()).toEqual([]);
    },
  );

  it.each([
    [
      "archived profile",
      {
        profileId: "profile-archived",
        householdId: "house-1",
        lifecycle: "archived",
      },
    ],
    [
      "다른 가구 profile",
      {
        profileId: "profile-foreign",
        householdId: "house-2",
        lifecycle: "active",
      },
    ],
  ] as const)(
    "[T-AST-007][T-AST-005][AST-001/AST-009] %s은 신규 자산 ownerRef로 승인하지 않는다",
    async (_label, profile) => {
      const subject = createSubject({ ownerProfiles: [profile] });

      expect(
        await subject.create(
          validCommand({
            type: "stock",
            ownerRef: { kind: "profile", profileId: profile.profileId },
          }),
        ),
      ).toEqual({ kind: "validation-error", code: "INVALID_OWNER_REF" });
      expect(subject.listAssets()).toEqual([]);
      expect(subject.recordedEvents()).toEqual([]);
    },
  );
});

import { describe, expect, it } from "vitest";
import { createPositionMutationLifecycleFixture } from "../../support/position-mutation-lifecycle-fixture";

interface PositionState {
  positionId: string;
  assetId: string;
  quantity: number;
  averagePriceInWon: number;
  evaluatedPriceInWon: number;
  aggregateVersion: number;
}

interface PositionAccountState {
  assetId: string;
  currentBalanceInWon: number;
  costBasisInWon: number;
  aggregateVersion: number;
}

interface PositionMutationReceipt {
  commandId: string;
  idempotencyKey: string;
  operation: "update" | "delete";
  positionId: string;
  resultingAssetVersion: number;
  resultingPositionVersion?: number;
}

type PositionMutationEvent =
  | {
      eventType: "PositionChanged.v1";
      operation: "updated";
      positionId: string;
      aggregateVersion: number;
    }
  | {
      eventType: "PositionRemoved.v1";
      positionId: string;
      aggregateVersion: number;
    }
  | {
      eventType: "AssetValuationChanged.v1";
      assetId: string;
      aggregateVersion: number;
      currentSignedBalance: number;
      costBasisInWon: number;
    };

type PositionMutationResult =
  | {
      kind: "success";
      asset: PositionAccountState;
      position?: PositionState;
      receipt: PositionMutationReceipt;
    }
  | {
      kind: "conflict";
      code: "POSITION_VERSION_MISMATCH" | "ASSET_VERSION_MISMATCH";
    }
  | { kind: "retryable-failure"; code: "PORTFOLIO_UOW_FAILED" };

interface PositionMutationFixture {
  asset: PositionAccountState;
  positions: readonly PositionState[];
  failParticipant?: "position" | "asset" | "receipt" | "outbox";
  transactionMayRetryCallback?: boolean;
}

/** Position 수정·삭제와 부모 Asset 재평가를 묶는 공개 UoW 계약입니다. */
export interface PositionMutationLifecycleSubject {
  update(command: {
    commandId: string;
    idempotencyKey: string;
    householdId: string;
    assetId: string;
    positionId: string;
    expectedAssetVersion: number;
    expectedPositionVersion: number;
    quantity: number;
    averagePriceInWon: number;
    evaluatedPriceInWon: number;
  }): Promise<PositionMutationResult>;
  delete(command: {
    commandId: string;
    idempotencyKey: string;
    householdId: string;
    assetId: string;
    positionId: string;
    expectedAssetVersion: number;
    expectedPositionVersion: number;
  }): Promise<PositionMutationResult>;
  queryAsset(assetId: string): Promise<PositionAccountState>;
  listPositions(assetId: string): Promise<readonly PositionState[]>;
  receipts(): readonly PositionMutationReceipt[];
  recordedEvents(): readonly PositionMutationEvent[];
}

export function createSubject(
  fixture: PositionMutationFixture,
): PositionMutationLifecycleSubject {
  return createPositionMutationLifecycleFixture(fixture);
}

const positionA: PositionState = {
  positionId: "position-a",
  assetId: "asset-stock",
  quantity: 10,
  averagePriceInWon: 90,
  evaluatedPriceInWon: 100,
  aggregateVersion: 2,
};

const positionB: PositionState = {
  positionId: "position-b",
  assetId: "asset-stock",
  quantity: 5,
  averagePriceInWon: 180,
  evaluatedPriceInWon: 200,
  aggregateVersion: 1,
};

const account: PositionAccountState = {
  assetId: "asset-stock",
  currentBalanceInWon: 2_000,
  costBasisInWon: 1_800,
  aggregateVersion: 7,
};

describe("Holdings Position 수정·삭제 원자성 계약", () => {
  it("[T-HOLD-001][HOLD-001/HOLD-003/HOLD-004] Position 수정은 부모 평가·두 version·receipt·Outbox를 한 번에 commit한다", async () => {
    const subject = createSubject({
      asset: account,
      positions: [positionA, positionB],
    });

    const result = await subject.update({
      commandId: "update-position-a",
      idempotencyKey: "update-position-a",
      householdId: "house-1",
      assetId: "asset-stock",
      positionId: "position-a",
      expectedAssetVersion: 7,
      expectedPositionVersion: 2,
      quantity: 20,
      averagePriceInWon: 80,
      evaluatedPriceInWon: 110,
    });

    expect(result).toEqual({
      kind: "success",
      asset: {
        assetId: "asset-stock",
        currentBalanceInWon: 3_200,
        costBasisInWon: 2_500,
        aggregateVersion: 8,
      },
      position: {
        positionId: "position-a",
        assetId: "asset-stock",
        quantity: 20,
        averagePriceInWon: 80,
        evaluatedPriceInWon: 110,
        aggregateVersion: 3,
      },
      receipt: {
        commandId: "update-position-a",
        idempotencyKey: "update-position-a",
        operation: "update",
        positionId: "position-a",
        resultingAssetVersion: 8,
        resultingPositionVersion: 3,
      },
    });
    expect(await subject.queryAsset("asset-stock")).toEqual(
      result.kind === "success" ? result.asset : undefined,
    );
    expect(await subject.listPositions("asset-stock")).toEqual([
      result.kind === "success" ? result.position : undefined,
      positionB,
    ]);
    expect(subject.receipts()).toEqual([
      result.kind === "success" ? result.receipt : undefined,
    ]);
    expect(subject.recordedEvents()).toEqual([
      {
        eventType: "PositionChanged.v1",
        operation: "updated",
        positionId: "position-a",
        aggregateVersion: 3,
      },
      {
        eventType: "AssetValuationChanged.v1",
        assetId: "asset-stock",
        aggregateVersion: 8,
        currentSignedBalance: 3_200,
        costBasisInWon: 2_500,
      },
    ]);
  });

  it("[T-HOLD-001][HOLD-001/HOLD-003/HOLD-004] Position 삭제는 남은 Position만으로 부모 합계를 다시 계산한다", async () => {
    const subject = createSubject({
      asset: account,
      positions: [positionA, positionB],
    });

    const result = await subject.delete({
      commandId: "delete-position-a",
      idempotencyKey: "delete-position-a",
      householdId: "house-1",
      assetId: "asset-stock",
      positionId: "position-a",
      expectedAssetVersion: 7,
      expectedPositionVersion: 2,
    });

    expect(result).toEqual({
      kind: "success",
      asset: {
        assetId: "asset-stock",
        currentBalanceInWon: 1_000,
        costBasisInWon: 900,
        aggregateVersion: 8,
      },
      receipt: {
        commandId: "delete-position-a",
        idempotencyKey: "delete-position-a",
        operation: "delete",
        positionId: "position-a",
        resultingAssetVersion: 8,
      },
    });
    expect(await subject.listPositions("asset-stock")).toEqual([positionB]);
    expect(await subject.queryAsset("asset-stock")).toEqual(
      result.kind === "success" ? result.asset : undefined,
    );
    expect(subject.recordedEvents()).toEqual([
      {
        eventType: "PositionRemoved.v1",
        positionId: "position-a",
        aggregateVersion: 3,
      },
      {
        eventType: "AssetValuationChanged.v1",
        assetId: "asset-stock",
        aggregateVersion: 8,
        currentSignedBalance: 1_000,
        costBasisInWon: 900,
      },
    ]);
  });

  it.each(["position", "asset", "receipt", "outbox"] as const)(
    "[T-HOLD-001][HOLD-004] %s participant 실패는 Position·부모·receipt·Event 전체를 이전 상태로 rollback한다",
    async (failParticipant) => {
      const subject = createSubject({
        asset: account,
        positions: [positionA, positionB],
        failParticipant,
      });

      expect(
        await subject.update({
          commandId: `update-failure-${failParticipant}`,
          idempotencyKey: `update-failure-${failParticipant}`,
          householdId: "house-1",
          assetId: "asset-stock",
          positionId: "position-a",
          expectedAssetVersion: 7,
          expectedPositionVersion: 2,
          quantity: 20,
          averagePriceInWon: 80,
          evaluatedPriceInWon: 110,
        }),
      ).toEqual({ kind: "retryable-failure", code: "PORTFOLIO_UOW_FAILED" });
      expect(await subject.queryAsset("asset-stock")).toEqual(account);
      expect(await subject.listPositions("asset-stock")).toEqual([
        positionA,
        positionB,
      ]);
      expect(subject.receipts()).toEqual([]);
      expect(subject.recordedEvents()).toEqual([]);
    },
  );

  it("[T-HOLD-001][HOLD-004] transaction callback 재실행과 idempotency replay에도 수정 결과·receipt·Event는 한 번뿐이다", async () => {
    const subject = createSubject({
      asset: account,
      positions: [positionA, positionB],
      transactionMayRetryCallback: true,
    });
    const command = {
      commandId: "update-replay",
      idempotencyKey: "update-replay",
      householdId: "house-1",
      assetId: "asset-stock",
      positionId: "position-a",
      expectedAssetVersion: 7,
      expectedPositionVersion: 2,
      quantity: 20,
      averagePriceInWon: 80,
      evaluatedPriceInWon: 110,
    };

    const first = await subject.update(command);
    const replay = await subject.update(command);

    expect(replay).toEqual(first);
    expect(await subject.queryAsset("asset-stock")).toEqual(
      expect.objectContaining({ aggregateVersion: 8 }),
    );
    expect(await subject.listPositions("asset-stock")).toEqual([
      expect.objectContaining({ positionId: "position-a", aggregateVersion: 3 }),
      positionB,
    ]);
    expect(subject.receipts()).toHaveLength(1);
    expect(subject.recordedEvents()).toHaveLength(2);
  });

  it.each([
    {
      label: "Asset version",
      expectedAssetVersion: 6,
      expectedPositionVersion: 2,
      code: "ASSET_VERSION_MISMATCH",
    },
    {
      label: "Position version",
      expectedAssetVersion: 7,
      expectedPositionVersion: 1,
      code: "POSITION_VERSION_MISMATCH",
    },
  ] as const)(
    "[T-HOLD-001][HOLD-004] stale $label은 전체 write 0건인 Conflict다",
    async ({ expectedAssetVersion, expectedPositionVersion, code }) => {
      const subject = createSubject({
        asset: account,
        positions: [positionA, positionB],
      });

      expect(
        await subject.delete({
          commandId: `delete-${code}`,
          idempotencyKey: `delete-${code}`,
          householdId: "house-1",
          assetId: "asset-stock",
          positionId: "position-a",
          expectedAssetVersion,
          expectedPositionVersion,
        }),
      ).toEqual({ kind: "conflict", code });
      expect(await subject.queryAsset("asset-stock")).toEqual(account);
      expect(await subject.listPositions("asset-stock")).toEqual([
        positionA,
        positionB,
      ]);
      expect(subject.receipts()).toEqual([]);
      expect(subject.recordedEvents()).toEqual([]);
    },
  );
});

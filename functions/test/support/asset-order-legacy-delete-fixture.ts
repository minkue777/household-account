import { createAssetOrderApplication } from "../../src/contexts/portfolio/core/application/assetOrderApplication";
import type { AssetOrderUnitOfWork } from "../../src/contexts/portfolio/core/application/ports/out/assetOrderUnitOfWork";
import type { AssetOrderDecision } from "../../src/contexts/portfolio/core/domain/model/assetOrder";
import type {
  OrderedAssetView,
  ReorderAssetsResult,
} from "../../src/contexts/portfolio/core/public";
import { createAssetLifecycleWorkflowDriver } from "./asset-lifecycle-workflow-driver";

export interface LegacyAssetState {
  readonly assets: readonly OrderedAssetView[];
  readonly positionIds: readonly string[];
  readonly historyIds: readonly string[];
}

export type LegacyDeleteResult =
  | { kind: "success" }
  | {
      kind: "partial-failure";
      code: "LEGACY_DEPENDENT_DELETE_FAILED";
      failedDataKind: "position" | "history";
    };

export interface LogicallyDeletedAssetView {
  readonly assetId: string;
  readonly lifecycle: "deleted";
  readonly aggregateVersion: number;
}

export interface AssetOrderLegacyDeleteFixtureSubject {
  reorder(input: {
    orderedAssetIds: readonly string[];
    expectedVersions: Readonly<Record<string, number>>;
  }): Promise<ReorderAssetsResult>;
  logicalDelete(input: {
    assetId: string;
    expectedVersion: number;
    commandId: string;
    idempotencyKey: string;
  }): Promise<
    | { kind: "success"; asset: LogicallyDeletedAssetView }
    | { kind: "conflict"; code: "ASSET_VERSION_MISMATCH" }
  >;
  legacyDelete(assetId: string): Promise<LegacyDeleteResult>;
  logicallyDeletedAsset(assetId: string): LogicallyDeletedAssetView | undefined;
  physicalDeleteAttempts(): number;
  currentState(): LegacyAssetState;
  recordedValuationEvents(): readonly unknown[];
}

function cloneState(state: LegacyAssetState): LegacyAssetState {
  return {
    assets: state.assets.map((asset) => ({ ...asset })),
    positionIds: [...state.positionIds],
    historyIds: [...state.historyIds],
  };
}

class FixtureOrderStore implements AssetOrderUnitOfWork {
  constructor(private readonly state: { assets: OrderedAssetView[] }) {}

  async transact(
    decide: (current: readonly OrderedAssetView[]) => AssetOrderDecision,
  ): Promise<ReorderAssetsResult> {
    const decision = decide(this.state.assets.map((asset) => ({ ...asset })));
    if (decision.kind === "return") return decision.result;
    this.state.assets = decision.assets.map((asset) => ({ ...asset }));
    return structuredClone(decision.result);
  }
}

export function createAssetOrderLegacyDeleteFixture(seed: {
  state: LegacyAssetState;
  failLegacyDeleteAt?: "position" | "history";
}): AssetOrderLegacyDeleteFixtureSubject {
  let state = cloneState(seed.state);
  let physicalDeleteAttemptCount = 0;
  let logicalDeleted: LogicallyDeletedAssetView | undefined;
  const mutableAssets = { assets: state.assets.map((asset) => ({ ...asset })) };
  const orderApplication = createAssetOrderApplication({
    unitOfWork: new FixtureOrderStore(mutableAssets),
  });
  const lifecycleAsset = state.assets[0];
  if (lifecycleAsset === undefined) throw new Error("자산 fixture가 필요합니다.");
  const lifecycle = createAssetLifecycleWorkflowDriver({
    state: {
      asset: {
        assetId: lifecycleAsset.assetId,
        householdId: "house-1",
        lifecycle: "active",
        aggregateVersion: lifecycleAsset.aggregateVersion,
      },
      dependents: {
        positions: state.positionIds.map((positionId) => ({
          positionId,
          retained: true,
          eligibleForProcessing: true,
        })),
        automation: {
          retained: true,
          executionEnabled: true,
          nextDueDate: "2026-08-01",
        },
        history: { retained: true, pointCount: state.historyIds.length },
        paidDividendEvents: [],
        annualDividendTotalInWon: 0,
      },
    },
  });

  return {
    async reorder(input) {
      const result = await orderApplication.reorder(input);
      state = { ...state, assets: mutableAssets.assets.map((asset) => ({ ...asset })) };
      return result;
    },
    async logicalDelete(input) {
      const result = await lifecycle.deleteAsset({
        actor: {
          actorId: "member-1",
          householdId: "house-1",
          capabilities: ["portfolio.asset.write"],
        },
        ...input,
      });
      if (result.kind === "success") {
        logicalDeleted = {
          assetId: result.asset.assetId,
          lifecycle: "deleted",
          aggregateVersion: result.asset.aggregateVersion,
        };
        return { kind: "success", asset: { ...logicalDeleted } };
      }
      if (result.kind === "conflict" && result.code === "ASSET_VERSION_MISMATCH") {
        return { kind: "conflict", code: "ASSET_VERSION_MISMATCH" };
      }
      throw new Error(`예상하지 못한 논리 삭제 결과: ${result.kind}`);
    },
    async legacyDelete(assetId) {
      physicalDeleteAttemptCount += 1;
      state = {
        ...state,
        assets: state.assets.filter((asset) => asset.assetId !== assetId),
      };
      if (seed.failLegacyDeleteAt === "position") {
        return {
          kind: "partial-failure",
          code: "LEGACY_DEPENDENT_DELETE_FAILED",
          failedDataKind: "position",
        };
      }
      state = {
        ...state,
        positionIds: state.positionIds.filter((id) => !id.startsWith(`${assetId}:`)),
      };
      if (seed.failLegacyDeleteAt === "history") {
        return {
          kind: "partial-failure",
          code: "LEGACY_DEPENDENT_DELETE_FAILED",
          failedDataKind: "history",
        };
      }
      state = {
        ...state,
        historyIds: state.historyIds.filter((id) => !id.startsWith(`${assetId}:`)),
      };
      return { kind: "success" };
    },
    logicallyDeletedAsset(assetId) {
      return logicalDeleted?.assetId === assetId ? { ...logicalDeleted } : undefined;
    },
    physicalDeleteAttempts: () => physicalDeleteAttemptCount,
    currentState: () => cloneState(state),
    recordedValuationEvents: () => [],
  };
}

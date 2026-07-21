import { createDemoAssetFixtureApplication } from "../../src/demo/portfolio/application/demoAssetFixtureApplication";
import type { DemoAssetFixtureInputPort } from "../../src/demo/portfolio/application/ports/in/demoAssetFixtureInputPort";
import type { DemoAssetDatasetUnitOfWork } from "../../src/demo/portfolio/application/ports/out/demoAssetFixturePorts";
import type {
  DemoAssetView,
  DemoFixtureResult,
} from "../../src/demo/portfolio/domain/demoAsset";

export type BuildKind = "production" | "demo";
export type TenantKind = "user" | "demo";
export type { DemoAssetView, DemoFixtureResult };

export interface PortfolioCompositionSurface {
  readonly buildKind: BuildKind;
  readonly capabilities: {
    readonly canSeedDemoAssets: boolean;
    readonly canRemoveDemoAssets: boolean;
  };
  readonly demoFixture?: DemoAssetFixtureInputPort;
}

export interface DemoAssetFixtureBoundaryDriver {
  inspectSurface(): PortfolioCompositionSurface;
  listAssets(tenantId: string): Promise<readonly DemoAssetView[]>;
}

export interface DemoFixtureBoundarySeed {
  readonly buildKind: BuildKind;
  readonly tenantKind: TenantKind;
  readonly tenantId: string;
  readonly existingAssets?: readonly DemoAssetView[];
  readonly failAtomicCommit?: boolean;
}

class FixtureDemoAssetStore implements DemoAssetDatasetUnitOfWork {
  private assets: DemoAssetView[];

  constructor(
    existingAssets: readonly DemoAssetView[],
    private failNextCommit: boolean,
  ) {
    this.assets = existingAssets.map((asset) => ({ ...asset }));
  }

  async seed(input: {
    tenantId: string;
    datasetId: string;
    assets: readonly DemoAssetView[];
  }): Promise<DemoFixtureResult> {
    if (this.failNextCommit) {
      this.failNextCommit = false;
      return {
        kind: "retryable-failure",
        code: "DEMO_DATASET_COMMIT_FAILED",
      };
    }
    const otherAssets = this.assets.filter(
      (asset) =>
        asset.tenantId !== input.tenantId ||
        asset.demoDatasetId !== input.datasetId,
    );
    this.assets = [...otherAssets, ...input.assets.map((asset) => ({ ...asset }))];
    return {
      kind: "success",
      datasetId: input.datasetId,
      affectedAssetIds: input.assets.map((asset) => asset.assetId),
    };
  }

  async remove(input: {
    tenantId: string;
    datasetId: string;
  }): Promise<DemoFixtureResult> {
    if (this.failNextCommit) {
      this.failNextCommit = false;
      return {
        kind: "retryable-failure",
        code: "DEMO_DATASET_COMMIT_FAILED",
      };
    }
    const affected = this.assets.filter(
      (asset) =>
        asset.tenantId === input.tenantId &&
        asset.demoDatasetId === input.datasetId,
    );
    this.assets = this.assets.filter(
      (asset) =>
        asset.tenantId !== input.tenantId ||
        asset.demoDatasetId !== input.datasetId,
    );
    return {
      kind: "success",
      datasetId: input.datasetId,
      affectedAssetIds: affected.map((asset) => asset.assetId),
    };
  }

  list(tenantId: string): readonly DemoAssetView[] {
    return this.assets
      .filter((asset) => asset.tenantId === tenantId)
      .map((asset) => ({ ...asset }));
  }
}

export function createDemoAssetFixtureBoundaryDriver(
  seed: DemoFixtureBoundarySeed,
): DemoAssetFixtureBoundaryDriver {
  const store = new FixtureDemoAssetStore(
    seed.existingAssets ?? [],
    seed.failAtomicCommit ?? false,
  );
  const demoFixture =
    seed.buildKind === "demo"
      ? createDemoAssetFixtureApplication({
          tenantPolicy: {
            isDemoTenant: (tenantId) =>
              tenantId === seed.tenantId && seed.tenantKind === "demo",
          },
          unitOfWork: store,
        })
      : undefined;

  return {
    inspectSurface() {
      return {
        buildKind: seed.buildKind,
        capabilities: {
          canSeedDemoAssets: seed.buildKind === "demo",
          canRemoveDemoAssets: seed.buildKind === "demo",
        },
        ...(demoFixture === undefined ? {} : { demoFixture }),
      };
    },
    async listAssets(tenantId) {
      return store.list(tenantId);
    },
  };
}

import type {
  DemoAssetView,
  DemoFixtureResult,
} from "../../../domain/demoAsset";

export interface DemoTenantPolicyPort {
  isDemoTenant(tenantId: string): boolean;
}

export interface DemoAssetDatasetUnitOfWork {
  seed(input: {
    tenantId: string;
    datasetId: string;
    assets: readonly DemoAssetView[];
  }): Promise<DemoFixtureResult>;
  remove(input: {
    tenantId: string;
    datasetId: string;
  }): Promise<DemoFixtureResult>;
}

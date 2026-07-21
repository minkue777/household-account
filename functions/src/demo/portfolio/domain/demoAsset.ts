export interface DemoAssetView {
  readonly assetId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly isDemo: true;
  readonly demoDatasetId: string;
}

export type DemoFixtureResult =
  | {
      readonly kind: "success";
      readonly datasetId: string;
      readonly affectedAssetIds: readonly string[];
    }
  | { readonly kind: "forbidden"; readonly code: "DEMO_SEED_FORBIDDEN" }
  | {
      readonly kind: "retryable-failure";
      readonly code: "DEMO_DATASET_COMMIT_FAILED";
    };

function stableAssetId(datasetId: string, suffix: string): string {
  return `demo:${datasetId}:${suffix}`;
}

export function demoAssetDataset(input: {
  readonly tenantId: string;
  readonly datasetId: string;
}): readonly DemoAssetView[] {
  return [
    {
      assetId: stableAssetId(input.datasetId, "deposit"),
      tenantId: input.tenantId,
      name: "Demo Deposit",
      isDemo: true,
      demoDatasetId: input.datasetId,
    },
    {
      assetId: stableAssetId(input.datasetId, "stock"),
      tenantId: input.tenantId,
      name: "Demo Stock",
      isDemo: true,
      demoDatasetId: input.datasetId,
    },
  ];
}

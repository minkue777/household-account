import { describe, expect, it } from "vitest";
import {
  createDemoAssetFixtureBoundaryDriver,
  type DemoAssetFixtureBoundaryDriver,
  type DemoAssetView,
  type DemoFixtureBoundarySeed,
} from "../../support/demo-asset-fixture-boundary-driver";

export interface DemoAssetFixtureBoundarySubject
  extends DemoAssetFixtureBoundaryDriver {}

export function createSubject(
  seed: DemoFixtureBoundarySeed,
): DemoAssetFixtureBoundarySubject {
  return createDemoAssetFixtureBoundaryDriver(seed);
}

describe("Portfolio demo 자산 fixture 격리 계약", () => {
  it("[T-AST-003][AST-007] production artifact에는 sample 진입점·Command·demo capability binding이 없다", async () => {
    const subject = createSubject({
      buildKind: "production",
      tenantKind: "user",
      tenantId: "household-real",
    });

    expect(subject.inspectSurface()).toEqual({
      buildKind: "production",
      capabilities: {
        canSeedDemoAssets: false,
        canRemoveDemoAssets: false,
      },
      demoFixture: undefined,
    });
    expect(await subject.listAssets("household-real")).toEqual([]);
  });

  it("[T-AST-003][AST-007] demo build의 격리 tenant만 dataset 표식이 있는 자산을 원자적으로 생성하고 결정적으로 제거한다", async () => {
    const subject = createSubject({
      buildKind: "demo",
      tenantKind: "demo",
      tenantId: "demo-tenant",
    });
    const fixture = subject.inspectSurface().demoFixture;
    expect(subject.inspectSurface().capabilities).toEqual({
      canSeedDemoAssets: true,
      canRemoveDemoAssets: true,
    });
    expect(fixture).toBeDefined();
    if (!fixture) throw new Error("demo build에는 fixture port가 있어야 합니다.");

    const seeded = await fixture.seed({
      tenantId: "demo-tenant",
      datasetId: "dataset-2026-07",
      capability: "portfolio.demo.seed",
    });

    expect(seeded).toEqual({
      kind: "success",
      datasetId: "dataset-2026-07",
      affectedAssetIds: expect.any(Array),
    });
    const seededAssets = await subject.listAssets("demo-tenant");
    expect(seededAssets.length).toBeGreaterThan(0);
    expect(
      seededAssets.every(
        (asset) => asset.isDemo && asset.demoDatasetId === "dataset-2026-07",
      ),
    ).toBe(true);

    expect(
      await fixture.remove({
        tenantId: "demo-tenant",
        datasetId: "dataset-2026-07",
        capability: "portfolio.demo.seed",
      }),
    ).toEqual({
      kind: "success",
      datasetId: "dataset-2026-07",
      affectedAssetIds: seededAssets.map(({ assetId }) => assetId),
    });
    expect(await subject.listAssets("demo-tenant")).toEqual([]);
  });

  it("[T-AST-003][AST-007] demo seed 중간 실패는 일부 sample을 남기지 않는다", async () => {
    const existingAsset: DemoAssetView = {
      assetId: "existing-demo-asset",
      tenantId: "demo-tenant",
      name: "기존 demo 자산",
      isDemo: true,
      demoDatasetId: "older-dataset",
    };
    const subject = createSubject({
      buildKind: "demo",
      tenantKind: "demo",
      tenantId: "demo-tenant",
      existingAssets: [existingAsset],
      failAtomicCommit: true,
    });
    const fixture = subject.inspectSurface().demoFixture;
    if (!fixture) throw new Error("demo build에는 fixture port가 있어야 합니다.");

    expect(
      await fixture.seed({
        tenantId: "demo-tenant",
        datasetId: "failing-dataset",
        capability: "portfolio.demo.seed",
      }),
    ).toEqual({
      kind: "retryable-failure",
      code: "DEMO_DATASET_COMMIT_FAILED",
    });
    expect(await subject.listAssets("demo-tenant")).toEqual([existingAsset]);
  });

  it("[T-AST-003][AST-007] demo build라도 실제 사용자 tenant에는 fixture write를 허용하지 않는다", async () => {
    const subject = createSubject({
      buildKind: "demo",
      tenantKind: "user",
      tenantId: "household-real",
    });
    const fixture = subject.inspectSurface().demoFixture;
    if (!fixture) throw new Error("demo build에는 fixture port가 있어야 합니다.");

    expect(
      await fixture.seed({
        tenantId: "household-real",
        datasetId: "must-not-exist",
        capability: "portfolio.demo.seed",
      }),
    ).toEqual({ kind: "forbidden", code: "DEMO_SEED_FORBIDDEN" });
    expect(await subject.listAssets("household-real")).toEqual([]);
  });

  it("[T-AST-003][AST-007] 같은 dataset을 다시 seed해도 중복 자산을 만들지 않는다", async () => {
    const subject = createSubject({
      buildKind: "demo",
      tenantKind: "demo",
      tenantId: "demo-tenant",
    });
    const fixture = subject.inspectSurface().demoFixture!;
    const command = {
      tenantId: "demo-tenant",
      datasetId: "stable-dataset",
      capability: "portfolio.demo.seed" as const,
    };

    const first = await fixture.seed(command);
    const second = await fixture.seed(command);

    expect(second).toEqual(first);
    expect((await subject.listAssets("demo-tenant")).length).toBe(2);
  });
});

import type { DemoFixtureResult } from "../../../domain/demoAsset";

export interface DemoFixtureCommand {
  readonly tenantId: string;
  readonly datasetId: string;
  readonly capability: "portfolio.demo.seed";
}

export interface DemoAssetFixtureInputPort {
  seed(command: DemoFixtureCommand): Promise<DemoFixtureResult>;
  remove(command: DemoFixtureCommand): Promise<DemoFixtureResult>;
}

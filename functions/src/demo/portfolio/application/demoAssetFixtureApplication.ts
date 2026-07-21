import { demoAssetDataset } from "../domain/demoAsset";
import type { DemoAssetFixtureInputPort } from "./ports/in/demoAssetFixtureInputPort";
import type {
  DemoAssetDatasetUnitOfWork,
  DemoTenantPolicyPort,
} from "./ports/out/demoAssetFixturePorts";

export function createDemoAssetFixtureApplication(dependencies: {
  tenantPolicy: DemoTenantPolicyPort;
  unitOfWork: DemoAssetDatasetUnitOfWork;
}): DemoAssetFixtureInputPort {
  const allowed = (tenantId: string) =>
    dependencies.tenantPolicy.isDemoTenant(tenantId);

  return {
    async seed(command) {
      if (!allowed(command.tenantId)) {
        return { kind: "forbidden", code: "DEMO_SEED_FORBIDDEN" };
      }
      return dependencies.unitOfWork.seed({
        tenantId: command.tenantId,
        datasetId: command.datasetId,
        assets: demoAssetDataset(command),
      });
    },
    async remove(command) {
      if (!allowed(command.tenantId)) {
        return { kind: "forbidden", code: "DEMO_SEED_FORBIDDEN" };
      }
      return dependencies.unitOfWork.remove(command);
    },
  };
}

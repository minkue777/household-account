import { decideAssetReorder } from "../domain/model/assetOrder";
import type { AssetOrderInputPort } from "./ports/in/assetOrderInputPort";
import type { AssetOrderUnitOfWork } from "./ports/out/assetOrderUnitOfWork";

export function createAssetOrderApplication(dependencies: {
  unitOfWork: AssetOrderUnitOfWork;
}): AssetOrderInputPort {
  return {
    reorder(command) {
      return dependencies.unitOfWork.transact((current) =>
        decideAssetReorder({ current, ...command }),
      );
    },
  };
}

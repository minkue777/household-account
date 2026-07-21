import { buildDimensionedAssetHistory } from "../domain/policies/assetHistoryDimensions";
import type { AssetHistoryInputPort } from "./ports/in/assetHistoryInputPort";
import type { AssetHistoryProjectionReader } from "./ports/out/assetHistoryProjectionReader";

export function createAssetHistoryApplication(dependencies: {
  projectionReader: AssetHistoryProjectionReader;
}): AssetHistoryInputPort {
  return {
    async queryHistory(input) {
      const source = await dependencies.projectionReader.read(input);
      if (source.kind !== "ready") return source;

      return {
        kind: "success",
        value: buildDimensionedAssetHistory(source),
      };
    },
  };
}

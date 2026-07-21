import type {
  AssetOwnerUiSurfaceInputPort,
  AssetOwnerUiSurfaceView,
  VerifiedAssetOwnerUiActor,
} from "./ports/in/assetOwnerUiSurfaceInputPort";
import type { ActiveAssetOwnerProfileQueryPort } from "./ports/out/activeAssetOwnerProfileQueryPort";
import {
  allowedAssetOwnerActions,
  composeAssetOwnerSelectorItems,
} from "../domain/policies/assetOwnerUiSurfacePolicy";

export interface AssetOwnerUiSurfaceApplicationDependencies {
  profiles: ActiveAssetOwnerProfileQueryPort;
}

class DefaultAssetOwnerUiSurfaceApplication
  implements AssetOwnerUiSurfaceInputPort
{
  constructor(
    private readonly dependencies: AssetOwnerUiSurfaceApplicationDependencies,
  ) {}

  async viewFor(
    actor: VerifiedAssetOwnerUiActor,
    surface: AssetOwnerUiSurfaceView["surface"],
  ): Promise<AssetOwnerUiSurfaceView> {
    const actions = allowedAssetOwnerActions(actor.capabilities, surface);
    if (surface === "administrator-owner-management") {
      return { surface, actions, selectorItems: [] };
    }

    const canSelect = actions.includes("select-owner");
    const profiles = canSelect
      ? await this.dependencies.profiles.listActiveProfiles(actor.principalRef)
      : [];
    return {
      surface,
      actions,
      selectorItems: canSelect
        ? composeAssetOwnerSelectorItems(
            profiles,
            actions.includes("create-dependent"),
          )
        : [],
    };
  }
}

export function createAssetOwnerUiSurfaceApplication(
  dependencies: AssetOwnerUiSurfaceApplicationDependencies,
): AssetOwnerUiSurfaceInputPort {
  return new DefaultAssetOwnerUiSurfaceApplication(dependencies);
}

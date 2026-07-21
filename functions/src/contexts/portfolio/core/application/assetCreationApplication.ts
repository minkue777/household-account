import type {
  AssetCreationInputPort,
  AssetValuationChangedEvent,
  AssetView,
  CreateAssetCommand,
  CreateAssetResult,
} from "./ports/in/assetCreationInputPort";
import type {
  AssetCreationClockPort,
  AssetCreationIdPort,
  AssetCreationUnitOfWorkPort,
  AssetOwnerProfileReferencePort,
} from "./ports/out/assetCreationPorts";
import { validateAssetCreation } from "../domain/model/assetCreation";

export interface AssetCreationDependencies {
  readonly ownerProfiles: AssetOwnerProfileReferencePort;
  readonly unitOfWork: AssetCreationUnitOfWorkPort;
  readonly ids: AssetCreationIdPort;
  readonly clock: AssetCreationClockPort;
}

class DefaultAssetCreationApplication implements AssetCreationInputPort {
  constructor(private readonly dependencies: AssetCreationDependencies) {}

  async create(input: CreateAssetCommand): Promise<CreateAssetResult> {
    const validation = validateAssetCreation(input);
    if (validation.kind === "invalid") {
      return { kind: "validation-error", code: validation.code };
    }
    const draft = validation.value;

    if (draft.ownerRef.kind === "profile") {
      const profile = await this.dependencies.ownerProfiles.find(
        draft.ownerRef.profileId,
      );
      if (
        profile === undefined ||
        profile.householdId !== draft.householdId ||
        profile.lifecycle !== "active"
      ) {
        return { kind: "validation-error", code: "INVALID_OWNER_REF" };
      }
    }

    const now = this.dependencies.clock.now();
    const asset: AssetView = {
      schemaVersion: 1,
      assetId: this.dependencies.ids.nextAssetId(),
      householdId: draft.householdId,
      name: draft.name,
      type: draft.type,
      ...(draft.subType === undefined ? {} : { subType: draft.subType }),
      ownerRef: draft.ownerRef,
      currency: draft.currency,
      currentBalance: draft.currentBalance,
      memo: draft.memo,
      order: draft.order,
      lifecycleState: "active",
      aggregateVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
    const event: AssetValuationChangedEvent = {
      eventType: "AssetValuationChanged.v1",
      assetId: asset.assetId,
      assetType: asset.type,
      ownerRef: asset.ownerRef,
      lifecycleState: "active",
      previousSignedBalance: 0,
      currentSignedBalance:
        asset.type === "loan"
          ? -Math.abs(asset.currentBalance)
          : asset.currentBalance,
      valuationAsOf: now,
      reason: "asset-created",
      aggregateVersion: 1,
    };

    await this.dependencies.unitOfWork.commit({ asset, event });
    return { kind: "success", value: asset };
  }
}

export function createAssetCreationApplication(
  dependencies: AssetCreationDependencies,
): AssetCreationInputPort {
  return new DefaultAssetCreationApplication(dependencies);
}

import { createAssetCreationApplication } from "../../src/contexts/portfolio/core/application/assetCreationApplication";
import type {
  AssetCreationClockPort,
  AssetCreationIdPort,
  AssetCreationUnitOfWorkPort,
  AssetOwnerProfileReference,
  AssetOwnerProfileReferencePort,
} from "../../src/contexts/portfolio/core/application/ports/out/assetCreationPorts";
import type {
  AssetCreationInputPort,
  AssetValuationChangedEvent,
  AssetView,
  CreateAssetResult,
} from "../../src/contexts/portfolio/core/public";

export type {
  AssetCreationInputPort,
  AssetCurrency,
  AssetOwnerRef,
  AssetType,
  AssetValuationChangedEvent,
  AssetView,
  CreateAssetCommand,
  CreateAssetResult,
  CreateAssetValidationCode,
} from "../../src/contexts/portfolio/core/public";

export interface AssetCreationFixture {
  readonly ownerProfiles?: readonly AssetOwnerProfileReference[];
}

export interface AssetCreationDriver extends AssetCreationInputPort {
  listAssets(): readonly AssetView[];
  recordedEvents(): readonly AssetValuationChangedEvent[];
}

function cloneOwnerRef(ownerRef: AssetView["ownerRef"]): AssetView["ownerRef"] {
  return ownerRef.kind === "household"
    ? { kind: "household" }
    : { kind: "profile", profileId: ownerRef.profileId };
}

function cloneAsset(asset: AssetView): AssetView {
  return { ...asset, ownerRef: cloneOwnerRef(asset.ownerRef) };
}

function cloneEvent(
  event: AssetValuationChangedEvent,
): AssetValuationChangedEvent {
  return { ...event, ownerRef: cloneOwnerRef(event.ownerRef) };
}

class FixtureAssetOwnerProfileReferences
  implements AssetOwnerProfileReferencePort
{
  private readonly profiles: ReadonlyMap<string, AssetOwnerProfileReference>;

  constructor(profiles: readonly AssetOwnerProfileReference[]) {
    this.profiles = new Map(
      profiles.map((profile) => [profile.profileId, { ...profile }]),
    );
  }

  async find(
    profileId: string,
  ): Promise<AssetOwnerProfileReference | undefined> {
    const profile = this.profiles.get(profileId);
    return profile === undefined ? undefined : { ...profile };
  }
}

class InMemoryAssetCreationUnitOfWork
  implements AssetCreationUnitOfWorkPort
{
  private assets: AssetView[] = [];
  private events: AssetValuationChangedEvent[] = [];

  async commit(input: {
    readonly asset: AssetView;
    readonly event: AssetValuationChangedEvent;
  }): Promise<void> {
    const nextAssets = [...this.assets, cloneAsset(input.asset)];
    const nextEvents = [...this.events, cloneEvent(input.event)];
    this.assets = nextAssets;
    this.events = nextEvents;
  }

  assetViews(): readonly AssetView[] {
    return this.assets.map(cloneAsset);
  }

  eventViews(): readonly AssetValuationChangedEvent[] {
    return this.events.map(cloneEvent);
  }
}

class SequentialAssetCreationIds implements AssetCreationIdPort {
  private sequence = 0;

  nextAssetId(): string {
    this.sequence += 1;
    return `asset-${this.sequence}`;
  }
}

class FixedAssetCreationClock implements AssetCreationClockPort {
  now(): string {
    return "2026-07-20T00:00:00.000Z";
  }
}

class DefaultAssetCreationDriver implements AssetCreationDriver {
  constructor(
    private readonly application: AssetCreationInputPort,
    private readonly unitOfWork: InMemoryAssetCreationUnitOfWork,
  ) {}

  create(
    input: Parameters<AssetCreationInputPort["create"]>[0],
  ): Promise<CreateAssetResult> {
    return this.application.create(input);
  }

  listAssets(): readonly AssetView[] {
    return this.unitOfWork.assetViews();
  }

  recordedEvents(): readonly AssetValuationChangedEvent[] {
    return this.unitOfWork.eventViews();
  }
}

export function createAssetCreationDriver(
  fixture: AssetCreationFixture = {},
): AssetCreationDriver {
  const unitOfWork = new InMemoryAssetCreationUnitOfWork();
  const application = createAssetCreationApplication({
    ownerProfiles: new FixtureAssetOwnerProfileReferences(
      fixture.ownerProfiles ?? [],
    ),
    unitOfWork,
    ids: new SequentialAssetCreationIds(),
    clock: new FixedAssetCreationClock(),
  });
  return new DefaultAssetCreationDriver(application, unitOfWork);
}

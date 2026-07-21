import { createAssetCreationApplication } from "../../src/contexts/portfolio/core/application/assetCreationApplication";
import type {
  AssetCreationClockPort,
  AssetCreationIdPort,
  AssetCreationUnitOfWorkPort,
  AssetOwnerProfileReferencePort,
} from "../../src/contexts/portfolio/core/application/ports/out/assetCreationPorts";
import type {
  AssetOwnerRef,
  AssetValuationChangedEvent,
  AssetView,
  CreateAssetValidationCode,
} from "../../src/contexts/portfolio/core/public";
import type {
  AssetOwnerProfileCommandResult as AccessProfileCommandResult,
  AssetOwnerProfileInputPort,
  AssetOwnerProfileView as AccessProfileView,
  VerifiedProfileActor,
} from "../../src/contexts/access/public";
import {
  createAssetOwnerProfileFixtureSubject,
  type AssetOwnerProfileFixture,
} from "./asset-owner-profile-fixture";

export type OwnerProfileKind = "login-member" | "dependent";

export interface OwnerProfileView {
  readonly profileId: string;
  readonly householdId: string;
  readonly displayName: string;
  readonly kind: OwnerProfileKind;
  readonly lifecycle: "active" | "archived";
  readonly version: number;
}

export interface OwnerActor {
  readonly principalUid: string;
  readonly actingMemberId?: string;
  readonly householdId: string;
  readonly capabilities: readonly string[];
}

export interface OwnerSelectorView {
  readonly includesHouseholdTotal: true;
  readonly activeProfiles: readonly OwnerProfileView[];
  readonly capabilities: {
    readonly canCreateDependentProfile: boolean;
    readonly canArchiveProfile: boolean;
  };
}

export interface OwnedAssetView {
  readonly assetId: string;
  readonly householdId: string;
  readonly name: string;
  readonly ownerRef: AssetOwnerRef;
}

export interface OwnerHistoryPoint {
  readonly snapshotDate: string;
  readonly ownerRefKey: string;
  readonly amountInWon: number;
}

export type OwnerProfileCommandResult =
  | { readonly kind: "success"; readonly profile: OwnerProfileView }
  | { readonly kind: "forbidden"; readonly code: string }
  | { readonly kind: "validation-error"; readonly code: string }
  | { readonly kind: "conflict"; readonly code: string }
  | {
      readonly kind: "not-found";
      readonly resource: "AssetOwnerProfile";
      readonly id: string;
    };

export type OwnedAssetCommandResult =
  | { readonly kind: "success"; readonly asset: OwnedAssetView }
  | {
      readonly kind: "validation-error";
      readonly code: CreateAssetValidationCode;
    };

export interface LifecycleMemberBinding {
  readonly profileId: string;
  readonly principalUid: string;
  readonly memberId: string;
}

export interface AssetOwnerProfileLifecycleFixture {
  readonly profiles: readonly OwnerProfileView[];
  readonly memberBindings: readonly LifecycleMemberBinding[];
  readonly assets?: readonly OwnedAssetView[];
  readonly history?: readonly OwnerHistoryPoint[];
}

export interface AssetOwnerProfileLifecycleDriver {
  getOwnerSelector(actor: OwnerActor): Promise<OwnerSelectorView>;
  createDependentProfile(command: {
    readonly actor: OwnerActor;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly displayName: string;
  }): Promise<OwnerProfileCommandResult>;
  archiveProfile(command: {
    readonly actor: OwnerActor;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly profileId: string;
    readonly expectedVersion: number;
    readonly auditReason: string;
  }): Promise<OwnerProfileCommandResult>;
  createAsset(command: {
    readonly actor: OwnerActor;
    readonly commandId: string;
    readonly name: string;
    readonly ownerRef: AssetOwnerRef;
  }): Promise<OwnedAssetCommandResult>;
  listCurrentAssets(actor: OwnerActor): Promise<readonly OwnedAssetView[]>;
  listHistoricalOwnerDimensions(
    actor: OwnerActor,
  ): Promise<readonly { ownerRefKey: string; displayName: string }[]>;
  queryOwnerHistory(
    actor: OwnerActor,
    ownerRefKey: string,
  ): Promise<readonly OwnerHistoryPoint[]>;
}

function cloneOwnerRef(ownerRef: AssetOwnerRef): AssetOwnerRef {
  return ownerRef.kind === "household"
    ? { kind: "household" }
    : { kind: "profile", profileId: ownerRef.profileId };
}

function cloneOwnedAsset(asset: OwnedAssetView): OwnedAssetView {
  return { ...asset, ownerRef: cloneOwnerRef(asset.ownerRef) };
}

function toOwnerProfile(profile: AccessProfileView): OwnerProfileView {
  return {
    profileId: profile.profileId,
    householdId: profile.householdId,
    displayName: profile.displayName,
    kind: profile.profileType === "member" ? "login-member" : "dependent",
    lifecycle: profile.lifecycleState,
    version: profile.aggregateVersion,
  };
}

function toAccessActor(actor: OwnerActor): VerifiedProfileActor {
  const capabilities: VerifiedProfileActor["capabilities"][number][] = [];
  if (actor.capabilities.includes("household.asset-owner-profile.write")) {
    capabilities.push("household.asset-owner-profile.write");
  }
  if (actor.capabilities.includes("admin.asset-owner-profile.archive")) {
    capabilities.push("admin.asset-owner-profile.archive");
  }
  return {
    principalUid: actor.principalUid,
    householdId: actor.householdId,
    ...(actor.actingMemberId === undefined
      ? {}
      : { actingMemberId: actor.actingMemberId }),
    capabilities,
  };
}

function toAccessFixture(
  fixture: AssetOwnerProfileLifecycleFixture,
): AssetOwnerProfileFixture {
  const bindings = new Map(
    fixture.memberBindings.map((binding) => [binding.profileId, binding]),
  );
  const memberProfiles = fixture.profiles.filter(
    (profile) => profile.kind === "login-member",
  );

  return {
    householdId:
      memberProfiles.find((profile) =>
        fixture.memberBindings.some(
          (binding) => binding.profileId === profile.profileId,
        ),
      )?.householdId ?? fixture.profiles[0]?.householdId ?? "",
    members: memberProfiles.map((profile) => {
      const binding = bindings.get(profile.profileId);
      if (binding === undefined) {
        throw new Error(
          `로그인 명의자 ${profile.profileId}의 member binding이 필요합니다.`,
        );
      }
      return {
        principalUid: binding.principalUid,
        memberId: binding.memberId,
        displayName: profile.displayName,
        profileId: profile.profileId,
        aggregateVersion: profile.version,
      };
    }),
    dependentProfiles: fixture.profiles
      .filter((profile) => profile.kind === "dependent")
      .map((profile) => ({
        profileId: profile.profileId,
        householdId: profile.householdId,
        displayName: profile.displayName,
        profileType: "dependent" as const,
        lifecycleState: profile.lifecycle,
        aggregateVersion: profile.version,
      })),
  };
}

function mapProfileCommandResult(
  result: AccessProfileCommandResult,
): OwnerProfileCommandResult {
  if (result.kind === "success") {
    return { kind: "success", profile: toOwnerProfile(result.profile) };
  }
  return { ...result };
}

class AccessOwnerProfileReferenceAdapter
  implements AssetOwnerProfileReferencePort
{
  constructor(
    private readonly access: AssetOwnerProfileInputPort,
    private readonly actor: VerifiedProfileActor,
  ) {}

  async find(profileId: string) {
    const profile = await this.access.resolveOwnerProfileForHistory(
      this.actor,
      profileId,
    );
    return profile === undefined
      ? undefined
      : {
          profileId: profile.profileId,
          householdId: profile.householdId,
          lifecycle: profile.lifecycleState,
        };
  }
}

class LifecycleAssetStore implements AssetCreationUnitOfWorkPort {
  private assets: AssetView[] = [];

  async commit(input: {
    readonly asset: AssetView;
    readonly event: AssetValuationChangedEvent;
  }): Promise<void> {
    this.assets = [
      ...this.assets,
      { ...input.asset, ownerRef: cloneOwnerRef(input.asset.ownerRef) },
    ];
  }

  list(): readonly AssetView[] {
    return this.assets.map((asset) => ({
      ...asset,
      ownerRef: cloneOwnerRef(asset.ownerRef),
    }));
  }
}

class LifecycleAssetIds implements AssetCreationIdPort {
  private sequence = 0;

  nextAssetId(): string {
    this.sequence += 1;
    return `asset-owner-profile-${this.sequence}`;
  }
}

class LifecycleClock implements AssetCreationClockPort {
  now(): string {
    return "2026-07-20T00:00:00.000Z";
  }
}

class DefaultAssetOwnerProfileLifecycleDriver
  implements AssetOwnerProfileLifecycleDriver
{
  private readonly access: AssetOwnerProfileInputPort;
  private readonly assetStore = new LifecycleAssetStore();
  private readonly ids = new LifecycleAssetIds();
  private readonly clock = new LifecycleClock();
  private readonly seededAssets: readonly OwnedAssetView[];
  private readonly history: readonly OwnerHistoryPoint[];

  constructor(fixture: AssetOwnerProfileLifecycleFixture) {
    this.access = createAssetOwnerProfileFixtureSubject(toAccessFixture(fixture));
    this.seededAssets = (fixture.assets ?? []).map(cloneOwnedAsset);
    this.history = (fixture.history ?? []).map((point) => ({ ...point }));
  }

  async getOwnerSelector(actor: OwnerActor): Promise<OwnerSelectorView> {
    const result = await this.access.listAssetOwnerProfiles(
      toAccessActor(actor),
      {},
    );
    if (result.kind === "forbidden") {
      throw new Error(result.code);
    }
    return {
      includesHouseholdTotal: true,
      activeProfiles:
        result.kind === "success" ? result.profiles.map(toOwnerProfile) : [],
      capabilities: {
        canCreateDependentProfile: actor.capabilities.includes(
          "household.asset-owner-profile.write",
        ),
        canArchiveProfile: actor.capabilities.includes(
          "admin.asset-owner-profile.archive",
        ),
      },
    };
  }

  async createDependentProfile(command: {
    readonly actor: OwnerActor;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly displayName: string;
  }): Promise<OwnerProfileCommandResult> {
    return mapProfileCommandResult(
      await this.access.createAssetOwnerProfile(toAccessActor(command.actor), {
        displayName: command.displayName,
        idempotencyKey: command.idempotencyKey,
      }),
    );
  }

  async archiveProfile(command: {
    readonly actor: OwnerActor;
    readonly commandId: string;
    readonly idempotencyKey: string;
    readonly profileId: string;
    readonly expectedVersion: number;
    readonly auditReason: string;
  }): Promise<OwnerProfileCommandResult> {
    return mapProfileCommandResult(
      await this.access.archiveAssetOwnerProfile(toAccessActor(command.actor), {
        profileId: command.profileId,
        expectedVersion: command.expectedVersion,
        idempotencyKey: command.idempotencyKey,
      }),
    );
  }

  async createAsset(command: {
    readonly actor: OwnerActor;
    readonly commandId: string;
    readonly name: string;
    readonly ownerRef: AssetOwnerRef;
  }): Promise<OwnedAssetCommandResult> {
    const application = createAssetCreationApplication({
      ownerProfiles: new AccessOwnerProfileReferenceAdapter(
        this.access,
        toAccessActor(command.actor),
      ),
      unitOfWork: this.assetStore,
      ids: this.ids,
      clock: this.clock,
    });
    const result = await application.create({
      householdId: command.actor.householdId,
      name: command.name,
      type: "stock",
      ownerRef: command.ownerRef,
      currency: "KRW",
      currentBalance: 0,
      memo: "",
      order: this.seededAssets.length + this.assetStore.list().length,
    });
    if (result.kind === "validation-error") {
      return result;
    }
    return {
      kind: "success",
      asset: {
        assetId: result.value.assetId,
        householdId: result.value.householdId,
        name: result.value.name,
        ownerRef: cloneOwnerRef(result.value.ownerRef),
      },
    };
  }

  async listCurrentAssets(
    actor: OwnerActor,
  ): Promise<readonly OwnedAssetView[]> {
    return [
      ...this.seededAssets,
      ...this.assetStore.list().map((asset) => ({
        assetId: asset.assetId,
        householdId: asset.householdId,
        name: asset.name,
        ownerRef: cloneOwnerRef(asset.ownerRef),
      })),
    ]
      .filter((asset) => asset.householdId === actor.householdId)
      .map(cloneOwnedAsset);
  }

  async listHistoricalOwnerDimensions(
    actor: OwnerActor,
  ): Promise<readonly { ownerRefKey: string; displayName: string }[]> {
    const ownerRefKeys = [
      ...new Set(this.history.map((point) => point.ownerRefKey)),
    ];
    const dimensions: { ownerRefKey: string; displayName: string }[] = [];
    for (const ownerRefKey of ownerRefKeys) {
      if (ownerRefKey === "household") {
        dimensions.push({ ownerRefKey, displayName: "가구 공동" });
        continue;
      }
      if (!ownerRefKey.startsWith("profile:")) continue;
      const profile = await this.access.resolveOwnerProfileForHistory(
        toAccessActor(actor),
        ownerRefKey.slice("profile:".length),
      );
      if (profile !== undefined) {
        dimensions.push({ ownerRefKey, displayName: profile.displayName });
      }
    }
    return dimensions;
  }

  async queryOwnerHistory(
    _actor: OwnerActor,
    ownerRefKey: string,
  ): Promise<readonly OwnerHistoryPoint[]> {
    return this.history
      .filter((point) => point.ownerRefKey === ownerRefKey)
      .map((point) => ({ ...point }));
  }
}

export function createAssetOwnerProfileLifecycleDriver(
  fixture: AssetOwnerProfileLifecycleFixture,
): AssetOwnerProfileLifecycleDriver {
  return new DefaultAssetOwnerProfileLifecycleDriver(fixture);
}

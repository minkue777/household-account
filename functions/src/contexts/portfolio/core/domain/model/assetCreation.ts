export type AssetType =
  | "savings"
  | "stock"
  | "crypto"
  | "property"
  | "gold"
  | "loan";

export type AssetOwnerRef =
  | { readonly kind: "household" }
  | { readonly kind: "profile"; readonly profileId: string };

export type AssetCurrency = "KRW" | "USD";

export interface AssetView {
  readonly schemaVersion: 1;
  readonly assetId: string;
  readonly householdId: string;
  readonly name: string;
  readonly type: AssetType;
  readonly subType?: string;
  readonly ownerRef: AssetOwnerRef;
  readonly currency: AssetCurrency;
  readonly currentBalance: number;
  readonly memo: string;
  readonly order: number;
  readonly lifecycleState: "active";
  readonly aggregateVersion: 1;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateAssetCommand {
  readonly householdId: string;
  readonly name: unknown;
  readonly type: unknown;
  readonly subType?: unknown;
  readonly ownerRef: unknown;
  readonly currency: unknown;
  readonly currentBalance: unknown;
  readonly memo: string;
  readonly order: unknown;
}

export type CreateAssetValidationCode =
  | "ASSET_NAME_REQUIRED"
  | "INVALID_ASSET_TYPE"
  | "INVALID_ASSET_SUBTYPE"
  | "INVALID_MONEY"
  | "INVALID_OWNER_REF"
  | "INVALID_CURRENCY"
  | "INVALID_ORDER_SET";

export type CreateAssetResult =
  | { readonly kind: "success"; readonly value: AssetView }
  | {
      readonly kind: "validation-error";
      readonly code: CreateAssetValidationCode;
    };

export interface AssetValuationChangedEvent {
  readonly eventType: "AssetValuationChanged.v1";
  readonly assetId: string;
  readonly assetType: AssetType;
  readonly ownerRef: AssetOwnerRef;
  readonly lifecycleState: "active";
  readonly previousSignedBalance: 0;
  readonly currentSignedBalance: number;
  readonly valuationAsOf: string;
  readonly reason: "asset-created";
  readonly aggregateVersion: 1;
}

export interface ValidatedAssetCreation {
  readonly householdId: string;
  readonly name: string;
  readonly type: AssetType;
  readonly subType?: string;
  readonly ownerRef: AssetOwnerRef;
  readonly currency: AssetCurrency;
  readonly currentBalance: number;
  readonly memo: string;
  readonly order: number;
}

export type AssetCreationValidation =
  | { readonly kind: "valid"; readonly value: ValidatedAssetCreation }
  | {
      readonly kind: "invalid";
      readonly code: CreateAssetValidationCode;
    };

const ASSET_TYPES = new Set<AssetType>([
  "savings",
  "stock",
  "crypto",
  "property",
  "gold",
  "loan",
]);

const SUB_TYPES: Readonly<Record<AssetType, ReadonlySet<string>>> = {
  savings: new Set(["deposit", "installment", "insurance"]),
  stock: new Set(),
  crypto: new Set(),
  property: new Set(),
  gold: new Set(["physical", "stock"]),
  loan: new Set(["credit", "mortgage", "jeonse"]),
};

function isAssetType(value: unknown): value is AssetType {
  return typeof value === "string" && ASSET_TYPES.has(value as AssetType);
}

function validateOwnerShape(value: unknown): value is AssetOwnerRef {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { kind?: unknown; profileId?: unknown };
  if (candidate.kind === "household") {
    return !("profileId" in candidate);
  }
  return (
    candidate.kind === "profile" &&
    typeof candidate.profileId === "string" &&
    candidate.profileId.trim() !== ""
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function validateAssetCreation(
  input: CreateAssetCommand,
): AssetCreationValidation {
  if (typeof input.name !== "string" || input.name.trim() === "") {
    return { kind: "invalid", code: "ASSET_NAME_REQUIRED" };
  }
  if (!isAssetType(input.type)) {
    return { kind: "invalid", code: "INVALID_ASSET_TYPE" };
  }
  if (
    input.subType !== undefined &&
    (typeof input.subType !== "string" ||
      !SUB_TYPES[input.type].has(input.subType))
  ) {
    return { kind: "invalid", code: "INVALID_ASSET_SUBTYPE" };
  }
  if (!validateOwnerShape(input.ownerRef)) {
    return { kind: "invalid", code: "INVALID_OWNER_REF" };
  }
  if (input.currency !== "KRW" && input.currency !== "USD") {
    return { kind: "invalid", code: "INVALID_CURRENCY" };
  }
  if (!isNonNegativeInteger(input.currentBalance)) {
    return { kind: "invalid", code: "INVALID_MONEY" };
  }
  if (!isNonNegativeInteger(input.order)) {
    return { kind: "invalid", code: "INVALID_ORDER_SET" };
  }

  return {
    kind: "valid",
    value: {
      householdId: input.householdId,
      name: input.name.trim(),
      type: input.type,
      ...(input.subType === undefined ? {} : { subType: input.subType }),
      ownerRef:
        input.ownerRef.kind === "household"
          ? { kind: "household" }
          : {
              kind: "profile",
              profileId: input.ownerRef.profileId.trim(),
            },
      currency: input.currency,
      currentBalance: input.currentBalance,
      memo: input.memo.trim(),
      order: input.order,
    },
  };
}

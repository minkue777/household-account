import type {
  PortfolioCommandMetadata,
  PortfolioCommandResult,
  PortfolioRuntimeAsset,
  PortfolioRuntimeState,
} from "./ports/out/portfolioRuntimeStorePort";
import {
  parseAutomationFields,
  plansAfterAssetChange,
  validateAutomationForAsset,
} from "./portfolioAssetAutomationSynchronization";
import {
  ASSET_FIELDS,
  commit,
  containsOnly,
  error,
  noWrite,
  nonNegativeWon,
  normalizeAssetType,
  normalizeSubType,
  optionalFiniteNonNegative,
  optionalNonNegativeWon,
  optionalText,
  parseOwner,
  record,
  stable,
  success,
  validateAssetCreation,
  type PortfolioAtomicExecutor,
} from "./portfolioRuntimeSupport";
import { replaceAsset, valuationEvent } from "./portfolioRuntimeValuation";

export interface PortfolioAssetCommands {
  createAsset(input: {
    readonly metadata: PortfolioCommandMetadata;
    readonly asset: unknown;
  }): Promise<PortfolioCommandResult>;
  updateAsset(input: {
    readonly metadata: PortfolioCommandMetadata;
    readonly assetId: string;
    readonly changes: unknown;
    readonly expectedVersion?: number;
  }): Promise<PortfolioCommandResult>;
  reorderAssets(input: {
    readonly metadata: PortfolioCommandMetadata;
    readonly assets: readonly {
      readonly assetId: string;
      readonly order: number;
    }[];
  }): Promise<PortfolioCommandResult>;
  deleteAsset(input: {
    readonly metadata: PortfolioCommandMetadata;
    readonly assetId: string;
    readonly expectedVersion?: number;
  }): Promise<PortfolioCommandResult>;
}

export function createPortfolioAssetCommands(
  atomic: PortfolioAtomicExecutor,
): PortfolioAssetCommands {
  return {
    async createAsset({ metadata, asset: rawAsset }) {
      const raw = record(rawAsset);
      if (raw === undefined || !containsOnly(raw, ASSET_FIELDS)) {
        return error("INVALID_ASSET");
      }
      if (raw.isActive !== undefined && raw.isActive !== true) {
        return error("INVALID_ASSET_LIFECYCLE");
      }
      return atomic(metadata, (state) => {
        const type = normalizeAssetType(raw.type);
        if (type === undefined) return noWrite(state, error("INVALID_ASSET_TYPE"));
        const subType = normalizeSubType(type, raw.subType);
        const owner = parseOwner({
          rawOwnerRef: raw.ownerRef,
          rawOwner: raw.owner,
          profiles: state.ownerProfiles,
        });
        const currentBalance = nonNegativeWon(raw.currentBalance, "INVALID_MONEY");
        const costBasis = optionalNonNegativeWon(
          raw.costBasis,
          undefined,
          "INVALID_MONEY",
        );
        const initialInvestment = optionalNonNegativeWon(
          raw.initialInvestment,
          undefined,
          "INVALID_MONEY",
        );
        const quantity = optionalFiniteNonNegative(
          raw.quantity,
          undefined,
          "INVALID_QUANTITY",
        );
        const memo = optionalText(raw.memo, "", "INVALID_MEMO");
        const automation = parseAutomationFields(raw);
        if (
          subType.kind === "error" ||
          owner.kind === "error" ||
          currentBalance.kind === "error" ||
          costBasis.kind === "error" ||
          initialInvestment.kind === "error" ||
          quantity.kind === "error" ||
          memo.kind === "error" ||
          automation.kind === "error"
        ) {
          const failed = [
            subType,
            owner,
            currentBalance,
            costBasis,
            initialInvestment,
            quantity,
            memo,
            automation,
          ].find((candidate) => candidate.kind === "error") as
            | { readonly kind: "error"; readonly code: string }
            | undefined;
          return noWrite(state, error(failed?.code ?? "INVALID_ASSET"));
        }
        const order =
          raw.order === undefined
            ? state.assets.filter(({ lifecycleState }) => lifecycleState === "active")
                .length
            : raw.order;
        const currency = raw.currency ?? "KRW";
        const creation = validateAssetCreation({
          householdId: metadata.householdId,
          name: raw.name,
          type,
          ...(subType.value.canonical === undefined
            ? {}
            : { subType: subType.value.canonical }),
          ownerRef: owner.value.ownerRef,
          currency,
          currentBalance: currentBalance.value,
          memo: memo.value,
          order,
        });
        if (creation.kind === "invalid") {
          return noWrite(state, error(creation.code));
        }
        const assetId = `asset-${metadata.householdId}-${metadata.commandId}`;
        if (state.assets.some((candidate) => candidate.assetId === assetId)) {
          return noWrite(state, error("ASSET_ALREADY_EXISTS"));
        }
        const value = creation.value;
        const asset: PortfolioRuntimeAsset = {
          assetId,
          householdId: metadata.householdId,
          name: value.name,
          type: value.type,
          ...(value.subType === undefined ? {} : { subType: value.subType }),
          ...(subType.value.legacy === undefined
            ? {}
            : { legacySubType: subType.value.legacy }),
          ownerRef: value.ownerRef,
          ownerDisplayName: owner.value.displayName,
          currency: value.currency,
          currentBalance: value.currentBalance,
          ...(costBasis.value === undefined ? {} : { costBasis: costBasis.value }),
          memo: value.memo,
          order: value.order,
          lifecycleState: "active",
          aggregateVersion: 1,
          createdAt: metadata.occurredAt,
          updatedAt: metadata.occurredAt,
          ...(initialInvestment.value === undefined
            ? {}
            : { initialInvestment: initialInvestment.value }),
          ...(quantity.value === undefined ? {} : { quantity: quantity.value }),
          ...(typeof raw.stockCode === "string" && raw.stockCode.trim() !== ""
            ? { stockCode: raw.stockCode.trim() }
            : {}),
          ...(typeof raw.icon === "string" && raw.icon.trim() !== ""
            ? { icon: raw.icon.trim() }
            : {}),
          ...(typeof raw.color === "string" && raw.color.trim() !== ""
            ? { color: raw.color.trim() }
            : {}),
          automation: automation.value,
        };
        const automationError = validateAutomationForAsset(asset);
        if (automationError !== undefined) {
          return noWrite(state, error(automationError));
        }
        const withAsset: PortfolioRuntimeState = {
          ...state,
          assets: [...state.assets, asset],
        };
        const nextState: PortfolioRuntimeState = {
          ...withAsset,
          automationPlans: plansAfterAssetChange(
            withAsset,
            asset,
            metadata.occurredAt,
          ),
        };
        return commit(
          nextState,
          [
            valuationEvent({
              after: asset,
              reason: "asset-created",
              occurredAt: metadata.occurredAt,
            }),
          ],
          success({ assetId }),
        );
      });
    },

    async updateAsset({ metadata, assetId, changes, expectedVersion }) {
      const raw = record(changes);
      if (raw === undefined || !containsOnly(raw, ASSET_FIELDS)) {
        return error("INVALID_ASSET_PATCH");
      }
      if (raw.isActive !== undefined) return error("INVALID_ASSET_LIFECYCLE");
      return atomic(metadata, (state) => {
        const current = state.assets.find((asset) => asset.assetId === assetId);
        if (current === undefined) return noWrite(state, error("ASSET_NOT_FOUND"));
        if (current.lifecycleState !== "active") {
          return noWrite(state, error("ASSET_NOT_ACTIVE"));
        }
        if (
          expectedVersion !== undefined &&
          expectedVersion !== current.aggregateVersion
        ) {
          return noWrite(state, error("ASSET_VERSION_MISMATCH"));
        }
        const type =
          raw.type === undefined ? current.type : normalizeAssetType(raw.type);
        if (type === undefined) return noWrite(state, error("INVALID_ASSET_TYPE"));
        const subType = normalizeSubType(
          type,
          raw.subType === undefined ? current.subType : raw.subType,
        );
        const owner = parseOwner({
          rawOwnerRef: raw.ownerRef,
          rawOwner: raw.owner,
          profiles: state.ownerProfiles,
          current,
        });
        const name = optionalText(raw.name, current.name, "ASSET_NAME_REQUIRED");
        const balance = optionalNonNegativeWon(
          raw.currentBalance,
          current.currentBalance,
          "INVALID_MONEY",
        );
        const costBasis = optionalNonNegativeWon(
          raw.costBasis,
          current.costBasis,
          "INVALID_MONEY",
        );
        const initialInvestment = optionalNonNegativeWon(
          raw.initialInvestment,
          current.initialInvestment,
          "INVALID_MONEY",
        );
        const quantity = optionalFiniteNonNegative(
          raw.quantity,
          current.quantity,
          "INVALID_QUANTITY",
        );
        const memo = optionalText(raw.memo, current.memo, "INVALID_MEMO");
        const automation = parseAutomationFields(raw, current.automation);
        if (
          subType.kind === "error" ||
          owner.kind === "error" ||
          name.kind === "error" ||
          balance.kind === "error" ||
          costBasis.kind === "error" ||
          initialInvestment.kind === "error" ||
          quantity.kind === "error" ||
          memo.kind === "error" ||
          automation.kind === "error"
        ) {
          const failed = [
            subType,
            owner,
            name,
            balance,
            costBasis,
            initialInvestment,
            quantity,
            memo,
            automation,
          ].find((candidate) => candidate.kind === "error") as
            | { readonly kind: "error"; readonly code: string }
            | undefined;
          return noWrite(state, error(failed?.code ?? "INVALID_ASSET_PATCH"));
        }
        const currency = raw.currency ?? current.currency;
        const order = raw.order ?? current.order;
        const validation = validateAssetCreation({
          householdId: metadata.householdId,
          name: name.value,
          type,
          ...(subType.value.canonical === undefined
            ? {}
            : { subType: subType.value.canonical }),
          ownerRef: owner.value.ownerRef,
          currency,
          currentBalance: balance.value,
          memo: memo.value,
          order,
        });
        if (validation.kind === "invalid") {
          return noWrite(state, error(validation.code));
        }
        const updated: PortfolioRuntimeAsset = {
          ...current,
          name: validation.value.name,
          type: validation.value.type,
          ...(validation.value.subType === undefined
            ? { subType: undefined }
            : { subType: validation.value.subType }),
          ...(raw.subType === undefined
            ? {}
            : typeof raw.subType === "string" && raw.subType.trim() !== ""
              ? { legacySubType: raw.subType.trim() }
              : { legacySubType: undefined }),
          ownerRef: owner.value.ownerRef,
          ownerDisplayName: owner.value.displayName,
          currency: validation.value.currency,
          currentBalance: validation.value.currentBalance,
          ...(costBasis.value === undefined
            ? { costBasis: undefined }
            : { costBasis: costBasis.value }),
          memo: validation.value.memo,
          order: validation.value.order,
          ...(initialInvestment.value === undefined
            ? { initialInvestment: undefined }
            : { initialInvestment: initialInvestment.value }),
          ...(quantity.value === undefined
            ? { quantity: undefined }
            : { quantity: quantity.value }),
          ...(raw.stockCode === undefined
            ? {}
            : typeof raw.stockCode === "string" && raw.stockCode.trim() !== ""
              ? { stockCode: raw.stockCode.trim() }
              : { stockCode: undefined }),
          ...(raw.icon === undefined
            ? {}
            : typeof raw.icon === "string" && raw.icon.trim() !== ""
              ? { icon: raw.icon.trim() }
              : { icon: undefined }),
          ...(raw.color === undefined
            ? {}
            : typeof raw.color === "string" && raw.color.trim() !== ""
              ? { color: raw.color.trim() }
              : { color: undefined }),
          automation: automation.value,
          aggregateVersion: current.aggregateVersion + 1,
          updatedAt: metadata.occurredAt,
        };
        const automationError = validateAutomationForAsset(updated);
        if (automationError !== undefined) {
          return noWrite(state, error(automationError));
        }
        const comparableBefore = { ...current, aggregateVersion: 0, updatedAt: "" };
        const comparableAfter = { ...updated, aggregateVersion: 0, updatedAt: "" };
        if (stable(comparableBefore) === stable(comparableAfter)) {
          return commit(state, [], success({}));
        }
        const withAsset = replaceAsset(state, updated);
        const nextState: PortfolioRuntimeState = {
          ...withAsset,
          automationPlans: plansAfterAssetChange(
            withAsset,
            updated,
            metadata.occurredAt,
          ),
        };
        const valuationChanged =
          current.type !== updated.type ||
          stable(current.ownerRef) !== stable(updated.ownerRef) ||
          current.currentBalance !== updated.currentBalance ||
          current.costBasis !== updated.costBasis;
        return commit(
          nextState,
          valuationChanged
            ? [
                valuationEvent({
                  before: current,
                  after: updated,
                  reason: "asset-updated",
                  occurredAt: metadata.occurredAt,
                }),
              ]
            : [],
          success({}),
        );
      });
    },

    async reorderAssets({ metadata, assets }) {
      return atomic(metadata, (state) => {
        const active = state.assets.filter(
          ({ lifecycleState }) => lifecycleState === "active",
        );
        const requestedIds = new Set(assets.map(({ assetId }) => assetId));
        const currentIds = new Set(active.map(({ assetId }) => assetId));
        const orders = new Set(assets.map(({ order }) => order));
        const sortedOrders = [...orders].sort((left, right) => left - right);
        if (
          assets.length !== active.length ||
          requestedIds.size !== assets.length ||
          currentIds.size !== requestedIds.size ||
          [...requestedIds].some((assetId) => !currentIds.has(assetId)) ||
          orders.size !== assets.length ||
          sortedOrders.some((order, index) => order !== index)
        ) {
          return noWrite(state, error("INVALID_ORDER_SET"));
        }
        const orderById = new Map(assets.map((entry) => [entry.assetId, entry.order]));
        const nextAssets = state.assets.map((asset) => {
          if (asset.lifecycleState !== "active") return asset;
          const order = orderById.get(asset.assetId)!;
          return order === asset.order
            ? asset
            : {
                ...asset,
                order,
                aggregateVersion: asset.aggregateVersion + 1,
                updatedAt: metadata.occurredAt,
              };
        });
        return commit({ ...state, assets: nextAssets }, [], success({}));
      });
    },

    async deleteAsset({ metadata, assetId, expectedVersion }) {
      return atomic(metadata, (state) => {
        const current = state.assets.find((asset) => asset.assetId === assetId);
        if (current === undefined) return noWrite(state, error("ASSET_NOT_FOUND"));
        if (
          expectedVersion !== undefined &&
          expectedVersion !== current.aggregateVersion
        ) {
          return noWrite(state, error("ASSET_VERSION_MISMATCH"));
        }
        if (current.lifecycleState !== "active") {
          return noWrite(state, error("ASSET_NOT_ACTIVE"));
        }
        const deleted: PortfolioRuntimeAsset = {
          ...current,
          lifecycleState: "deleted",
          deletedAt: metadata.occurredAt,
          aggregateVersion: current.aggregateVersion + 1,
          updatedAt: metadata.occurredAt,
        };
        return commit(
          replaceAsset(state, deleted),
          [
            {
              eventType: "AssetLifecycleChanged.v1",
              aggregateId: assetId,
              aggregateVersion: deleted.aggregateVersion,
              payload: {
                assetId,
                before: "active",
                after: "deleted",
                deletedAt: metadata.occurredAt,
              },
            },
            valuationEvent({
              before: current,
              after: deleted,
              reason: "asset-deleted",
              occurredAt: metadata.occurredAt,
            }),
          ],
          success({}),
        );
      });
    },
  };
}

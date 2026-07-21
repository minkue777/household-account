import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";

import { FirebasePortfolioMarketData } from "../../adapters/firebase/portfolio/firebasePortfolioMarketData";
import { FirebasePortfolioProviderHealthStore } from "../../adapters/firebase/portfolio/firebasePortfolioProviderHealthStore";
import { FirebasePortfolioRuntimeStore } from "../../adapters/firebase/portfolio/firebasePortfolioRuntimeStore";
import { createPortfolioRuntimeApplication } from "../../contexts/portfolio/core/application/portfolioRuntimeApplication";
import type {
  PortfolioCommandMetadata,
  PortfolioCommandResult,
  PortfolioMarketQuotePort,
  PortfolioPositionKind,
} from "../../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";
import {
  HouseholdCommandRejection,
  type HouseholdCommandExecutionContext,
  type HouseholdCommandHandler,
} from "./householdCommand";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HouseholdCommandRejection("INVALID_PAYLOAD");
  }
  return value as Record<string, unknown>;
}

function exactFields(
  payload: Record<string, unknown>,
  expected: readonly string[],
): void {
  const allowed = new Set(expected);
  if (Object.keys(payload).some((field) => !allowed.has(field))) {
    throw new HouseholdCommandRejection("INVALID_PAYLOAD");
  }
}

function stringField(payload: Record<string, unknown>, field: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HouseholdCommandRejection(`${field.toUpperCase()}_REQUIRED`);
  }
  return value.trim();
}

function expectedVersion(
  payload: Record<string, unknown>,
): number | undefined {
  const value = payload.expectedVersion;
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new HouseholdCommandRejection("INVALID_EXPECTED_VERSION");
  }
  return value as number;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`)
    .join(",")}}`;
}

function metadata(
  context: HouseholdCommandExecutionContext,
): PortfolioCommandMetadata {
  if (context.actor === undefined) {
    throw new HouseholdCommandRejection("HOUSEHOLD_FORBIDDEN");
  }
  return {
    householdId: context.actor.householdId,
    principalUid: context.principalUid,
    actorMemberId: context.actor.actingMemberId,
    commandId: context.envelope.commandId,
    idempotencyKey: context.envelope.idempotencyKey,
    commandName: context.envelope.command,
    payloadFingerprint: createHash("sha256")
      .update(stable(context.envelope.payload), "utf8")
      .digest("hex"),
    occurredAt: context.requestedAt,
  };
}

function value(result: PortfolioCommandResult): Readonly<Record<string, unknown>> {
  if (result.kind === "success") return result.value;
  throw new HouseholdCommandRejection(result.code, result.retryable === true);
}

function positionKind(value: unknown): PortfolioPositionKind {
  if (value !== "stock" && value !== "crypto") {
    throw new HouseholdCommandRejection("UNSUPPORTED_POSITION_KIND");
  }
  return value;
}

export function createPortfolioHouseholdCommandHandlers(
  database: firestore.Firestore,
  marketQuotes: PortfolioMarketQuotePort = new FirebasePortfolioMarketData(),
): ReadonlyMap<string, HouseholdCommandHandler> {
  const application = createPortfolioRuntimeApplication({
    store: new FirebasePortfolioRuntimeStore(database),
    marketQuotes,
    providerHealth: new FirebasePortfolioProviderHealthStore(database),
  });
  return new Map<string, HouseholdCommandHandler>([
    [
      "portfolio.create-asset.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, ["asset"]);
          return value(
            await application.createAsset({
              metadata: metadata(context),
              asset: payload.asset,
            }),
          );
        },
      },
    ],
    [
      "portfolio.update-asset.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, ["assetId", "changes", "expectedVersion"]);
          return value(
            await application.updateAsset({
              metadata: metadata(context),
              assetId: stringField(payload, "assetId"),
              changes: payload.changes,
              ...(expectedVersion(payload) === undefined
                ? {}
                : { expectedVersion: expectedVersion(payload) }),
            }),
          );
        },
      },
    ],
    [
      "portfolio.reorder-assets.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, ["assets"]);
          if (!Array.isArray(payload.assets)) {
            throw new HouseholdCommandRejection("INVALID_ORDER_SET");
          }
          const assets = payload.assets.map((entry) => {
            const item = record(entry);
            exactFields(item, ["assetId", "order"]);
            if (!Number.isSafeInteger(item.order) || (item.order as number) < 0) {
              throw new HouseholdCommandRejection("INVALID_ORDER_SET");
            }
            return {
              assetId: stringField(item, "assetId"),
              order: item.order as number,
            };
          });
          return value(
            await application.reorderAssets({
              metadata: metadata(context),
              assets,
            }),
          );
        },
      },
    ],
    [
      "portfolio.delete-asset.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, ["assetId", "expectedVersion"]);
          const version = expectedVersion(payload);
          return value(
            await application.deleteAsset({
              metadata: metadata(context),
              assetId: stringField(payload, "assetId"),
              ...(version === undefined ? {} : { expectedVersion: version }),
            }),
          );
        },
      },
    ],
    [
      "portfolio.add-position.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, ["assetId", "positionKind", "position"]);
          return value(
            await application.addPosition({
              metadata: metadata(context),
              assetId: stringField(payload, "assetId"),
              positionKind: positionKind(payload.positionKind),
              position: payload.position,
            }),
          );
        },
      },
    ],
    [
      "portfolio.update-position.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, [
            "assetId",
            "positionId",
            "positionKind",
            "changes",
            "expectedVersion",
          ]);
          const version = expectedVersion(payload);
          return value(
            await application.updatePosition({
              metadata: metadata(context),
              assetId: stringField(payload, "assetId"),
              positionId: stringField(payload, "positionId"),
              positionKind: positionKind(payload.positionKind),
              changes: payload.changes,
              ...(version === undefined ? {} : { expectedVersion: version }),
            }),
          );
        },
      },
    ],
    [
      "portfolio.delete-position.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, [
            "assetId",
            "positionId",
            "positionKind",
            "expectedVersion",
          ]);
          const version = expectedVersion(payload);
          return value(
            await application.deletePosition({
              metadata: metadata(context),
              assetId: stringField(payload, "assetId"),
              positionId: stringField(payload, "positionId"),
              positionKind: positionKind(payload.positionKind),
              ...(version === undefined ? {} : { expectedVersion: version }),
            }),
          );
        },
      },
    ],
    [
      "portfolio.refresh-market-values.v1",
      {
        async execute(context) {
          const payload = record(context.envelope.payload);
          exactFields(payload, ["assetClass", "assetId"]);
          const assetClass = payload.assetClass;
          if (
            assetClass !== "stock" &&
            assetClass !== "crypto" &&
            assetClass !== "physical-gold" &&
            assetClass !== "all"
          ) {
            throw new HouseholdCommandRejection("INVALID_ASSET_CLASS");
          }
          return value(
            await application.refreshMarketValues({
              metadata: metadata(context),
              assetClass,
              ...(payload.assetId === undefined
                ? {}
                : { assetId: stringField(payload, "assetId") }),
            }),
          );
        },
      },
    ],
  ]);
}

import type * as firestore from "firebase-admin/firestore";
import { FieldPath, FieldValue } from "firebase-admin/firestore";

import type {
  AssetSnapshotProjectionView,
  PreviousAssetSnapshotView,
} from "../../../contexts/portfolio/core/public";
import type {
  AssetSnapshotProjectionStorePort,
  AssetSnapshotProjectionSourcePort,
} from "../../../contexts/portfolio/core/application/ports/out/assetSnapshotProjectionPorts";
import type { PortfolioRuntimeStorePort } from "../../../contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort";

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringMap(value: unknown): Readonly<Record<string, string>> {
  const source = record(value);
  if (source === undefined) return {};
  return Object.fromEntries(
    Object.entries(source).flatMap(([key, entry]) =>
      typeof entry === "string" ? [[key, entry] as const] : [],
    ),
  );
}

function numberMap(value: unknown): Readonly<Record<string, number>> {
  const source = record(value);
  if (source === undefined) return {};
  return Object.fromEntries(
    Object.entries(source).flatMap(([key, entry]) =>
      typeof entry === "number" && Number.isFinite(entry)
        ? [[key, entry] as const]
        : [],
    ),
  );
}

function ownerRefKey(ownerRef: { kind: "household" } | { kind: "profile"; profileId: string }): string {
  return ownerRef.kind === "household"
    ? "household"
    : `profile:${ownerRef.profileId}`;
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

function previousSnapshot(
  snapshot: firestore.QueryDocumentSnapshot,
): PreviousAssetSnapshotView {
  const data = snapshot.data();
  return {
    localDate:
      typeof data.localDate === "string" ? data.localDate : snapshot.id,
    total: finite(data.total),
    financial: finite(data.financial),
    byType: numberMap(data.byType),
    byOwnerRefKey: numberMap(data.byOwnerRefKey),
    ownerDisplayNames: stringMap(data.ownerDisplayNames),
  };
}

function canonicalComparable(
  snapshot: AssetSnapshotProjectionView,
): Readonly<Record<string, unknown>> {
  return {
    schemaVersion: snapshot.schemaVersion,
    householdId: snapshot.householdId,
    localDate: snapshot.localDate,
    total: snapshot.total,
    financial: snapshot.financial,
    byType: snapshot.byType,
    byOwnerRefKey: snapshot.byOwnerRefKey,
    ownerDisplayNames: snapshot.ownerDisplayNames,
    sourceAssetVersions: snapshot.sourceAssetVersions,
    sourceCheckpoint: snapshot.sourceCheckpoint,
    calculatedAt: snapshot.calculatedAt,
  };
}

export class FirebaseAssetSnapshotProjectionSource
  implements AssetSnapshotProjectionSourcePort
{
  constructor(private readonly portfolio: PortfolioRuntimeStorePort) {}

  async readCurrent(householdId: string) {
    const state = await this.portfolio.readState(householdId);
    const ownerDisplayNames: Record<string, string> = {};
    for (const asset of state.assets) {
      if (asset.lifecycleState !== "active") continue;
      ownerDisplayNames[ownerRefKey(asset.ownerRef)] =
        asset.ownerRef.kind === "household" ? "가구" : asset.ownerDisplayName;
    }
    return {
      assets: state.assets.map((asset) => ({
        assetId: asset.assetId,
        type: asset.type,
        ownerRef: asset.ownerRef,
        currentBalance: asset.currentBalance,
        aggregateVersion: asset.aggregateVersion,
        lifecycleState: asset.lifecycleState,
      })),
      ownerDisplayNames,
    };
  }
}

export class FirebaseAssetSnapshotProjectionStore
  implements AssetSnapshotProjectionStorePort
{
  constructor(private readonly database: firestore.Firestore) {}

  async latestBefore(input: {
    householdId: string;
    localDate: string;
  }): Promise<PreviousAssetSnapshotView | undefined> {
    const result = await this.database
      .collection("households")
      .doc(input.householdId)
      .collection("assetSnapshots")
      .where("localDate", "<", input.localDate)
      .orderBy("localDate", "desc")
      .limit(1)
      .get();
    return result.empty ? undefined : previousSnapshot(result.docs[0]);
  }

  async upsert(
    snapshot: AssetSnapshotProjectionView,
  ): Promise<"projected" | "replayed"> {
    const canonicalReference = this.database
      .collection("households")
      .doc(snapshot.householdId)
      .collection("assetSnapshots")
      .doc(snapshot.localDate);
    return this.database.runTransaction(async (transaction) => {
      const canonical = await transaction.get(canonicalReference);
      const existing = canonical.data();
      if (
        canonical.exists &&
        stable(canonicalComparable(snapshot)) ===
          stable({
            schemaVersion: existing?.schemaVersion,
            householdId: existing?.householdId,
            localDate: existing?.localDate,
            total: existing?.total,
            financial: existing?.financial,
            byType: existing?.byType,
            byOwnerRefKey: existing?.byOwnerRefKey,
            ownerDisplayNames: existing?.ownerDisplayNames,
            sourceAssetVersions: existing?.sourceAssetVersions,
            sourceCheckpoint: existing?.sourceCheckpoint,
            calculatedAt: existing?.calculatedAt,
          })
      ) {
        return "replayed" as const;
      }

      transaction.set(
        canonicalReference,
        {
          ...canonicalComparable(snapshot),
          createdAt: canonical.exists
            ? existing?.createdAt ?? FieldValue.serverTimestamp()
            : FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          freshness: "fresh",
        },
        { merge: true },
      );
      return "projected" as const;
    });
  }
}

export interface ActivePortfolioHouseholdPage {
  readonly householdId: string;
  readonly active: boolean;
}

/**
 * Scans one physical household document at a time. Missing lifecycleState is a
 * legacy active household; deleted/purging/purged households remain explicit
 * skipped targets so the scheduler checkpoint always advances.
 */
export class FirebaseActivePortfolioHouseholdReader {
  constructor(private readonly database: firestore.Firestore) {}

  async next(afterHouseholdId?: string): Promise<ActivePortfolioHouseholdPage | undefined> {
    let query = this.database
      .collection("households")
      .orderBy(FieldPath.documentId())
      .limit(1);
    if (afterHouseholdId !== undefined) query = query.startAfter(afterHouseholdId);
    const result = await query.get();
    if (result.empty) return undefined;
    const snapshot = result.docs[0];
    const data = snapshot.data();
    const lifecycle =
      typeof data.lifecycleState === "string" ? data.lifecycleState : undefined;
    return {
      householdId: snapshot.id,
      active:
        lifecycle === "active" ||
        (lifecycle === undefined && data.deletedAt === undefined),
    };
  }
}

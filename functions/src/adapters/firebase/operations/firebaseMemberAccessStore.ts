import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import {
  emptyMemberAccessStats,
  recordMemberAccess,
  type MemberAccessEvent,
  type MemberAccessPlatform,
  type MemberAccessStats,
} from "../../../platform/usage-observability/public";

const OPERATIONS_DOCUMENT = "runtime";

function statsCollection(
  database: firestore.Firestore,
): firestore.CollectionReference {
  return database
    .collection("operations")
    .doc(OPERATIONS_DOCUMENT)
    .collection("memberAccessStats");
}

function documentId(householdId: string, memberId: string): string {
  return createHash("sha256")
    .update(`${householdId}\u0000${memberId}`, "utf8")
    .digest("hex");
}

function count(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : 0;
}

function counts(value: unknown): Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, candidate]) => {
      const parsed = count(candidate);
      return parsed > 0 ? [[key, parsed]] : [];
    }),
  );
}

function platformCounts(
  value: unknown,
): Record<MemberAccessPlatform, number> {
  const parsed = counts(value);
  return {
    android: parsed.android ?? 0,
    "ios-pwa": parsed["ios-pwa"] ?? 0,
    web: parsed.web ?? 0,
  };
}

function mapStats(
  householdId: string,
  memberId: string,
  data: firestore.DocumentData | undefined,
): MemberAccessStats {
  const fallback = emptyMemberAccessStats(householdId, memberId);
  if (data === undefined) return fallback;
  return {
    householdId,
    memberId,
    totalAccessCount: count(data.totalAccessCount),
    ...(typeof data.lastAccessAt === "string"
      ? { lastAccessAt: data.lastAccessAt }
      : {}),
    platformCounts: platformCounts(data.platformCounts),
    dailyAccessCounts: counts(data.dailyAccessCounts),
    recentVisitIds: Array.isArray(data.recentVisitIds)
      ? data.recentVisitIds.filter(
          (visitId: unknown): visitId is string => typeof visitId === "string",
        )
      : [],
  };
}

export class FirebaseMemberAccessStore {
  constructor(private readonly database: firestore.Firestore) {}

  async record(event: MemberAccessEvent): Promise<{
    readonly kind: "recorded" | "already-recorded";
    readonly totalAccessCount: number;
  }> {
    const reference = statsCollection(this.database).doc(
      documentId(event.householdId, event.memberId),
    );
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const update = recordMemberAccess(
        mapStats(event.householdId, event.memberId, snapshot.data()),
        event,
      );
      if (!update.replayed) {
        transaction.set(
          reference,
          {
            ...update.stats,
            schemaVersion: 1,
            updatedAt: FieldValue.serverTimestamp(),
            ...(snapshot.exists
              ? {}
              : { createdAt: FieldValue.serverTimestamp() }),
          },
          { merge: true },
        );
      }
      return {
        kind: update.replayed ? "already-recorded" : "recorded",
        totalAccessCount: update.stats.totalAccessCount,
      };
    });
  }
}

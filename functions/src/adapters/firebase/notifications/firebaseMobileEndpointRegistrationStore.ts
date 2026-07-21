import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type { MobileNotificationEndpoint } from "../../../contexts/notifications/domain/model/mobileNotificationEndpoint";
import type {
  MobileEndpointIdentityPort,
  MobileEndpointRegistrationStore,
} from "../../../contexts/notifications/application/ports/outbound/mobileEndpointRegistrationStore";
import {
  firestoreInstantAsIso,
  firestoreTtlMergeField,
} from "../shared/firestoreTtl";

export function mapFirebaseMobileEndpoint(
  snapshot: firestore.DocumentSnapshot,
): MobileNotificationEndpoint | null {
  if (!snapshot.exists) return null;
  const data = snapshot.data();
  if (
    data === undefined ||
    typeof data.fid !== "string" ||
    typeof data.householdId !== "string" ||
    typeof data.memberId !== "string" ||
    (data.platform !== "android" && data.platform !== "ios-pwa")
  ) {
    throw new Error("Invalid notification endpoint document");
  }
  const expiresAt = firestoreInstantAsIso(data.expiresAt);
  return {
    endpointId: snapshot.id,
    fid: data.fid,
    householdId: data.householdId,
    memberId: data.memberId,
    platform: data.platform,
    status: data.status === "inactive" ? "inactive" : "active",
    registrationVersion: Number(data.registrationVersion ?? 1),
    bindingVersion: Number(data.bindingVersion ?? 1),
    deviceInfo:
      typeof data.deviceInfo === "object" && data.deviceInfo !== null
        ? data.deviceInfo
        : {},
    registeredAt: String(data.registeredAt ?? data.lastConfirmedAt ?? ""),
    lastConfirmedAt: String(data.lastConfirmedAt ?? data.registeredAt ?? ""),
    ...(typeof data.inactiveAt === "string"
      ? { inactiveAt: data.inactiveAt }
      : {}),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}

export class Sha256MobileEndpointIdentityAdapter
  implements MobileEndpointIdentityPort
{
  endpointIdFor(fid: string): string {
    return createHash("sha256").update(fid, "utf8").digest("hex");
  }
}

export class FirebaseMobileEndpointRegistrationStore
  implements MobileEndpointRegistrationStore
{
  constructor(private readonly database: firestore.Firestore) {}

  runForEndpoint<T>(
    endpointId: string,
    operation: Parameters<MobileEndpointRegistrationStore["runForEndpoint"]>[1],
  ): Promise<T> {
    const reference = this.database
      .collection("notificationEndpoints")
      .doc(endpointId);
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      return operation({
        read: async () => mapFirebaseMobileEndpoint(snapshot),
        save: async (endpoint) => {
          const { expiresAt, inactiveAt, ...activeFields } = endpoint;
          transaction.set(
            reference,
            {
              ...activeFields,
              ...(inactiveAt === undefined
                ? { inactiveAt: FieldValue.delete() }
                : { inactiveAt }),
              ...firestoreTtlMergeField(expiresAt),
              schemaVersion: 1,
              updatedAt: FieldValue.serverTimestamp(),
              ...(snapshot.exists
                ? {}
                : { createdAt: FieldValue.serverTimestamp() }),
            },
            { merge: true },
          );
        },
        remove: async () => {
          transaction.delete(reference);
        },
      }) as Promise<T>;
    });
  }
}

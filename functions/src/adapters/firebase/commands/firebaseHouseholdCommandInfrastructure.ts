import { createHash } from "node:crypto";

import type * as firestore from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";

import type {
  HouseholdCommandHashPort,
  HouseholdCommandMembershipPort,
  HouseholdCommandReceiptClaim,
  HouseholdCommandReceiptPort,
  ResolveHouseholdActorResult,
} from "../../../bootstrap/commands/householdCommandPorts";
import type { HouseholdCommandResult } from "../../../bootstrap/commands/householdCommand";
import { STANDARD_MEMBER_CAPABILITIES } from "../../../contexts/access/google-onboarding/domain/policies/googleOnboardingPolicy";
import { principalClaimId } from "../access/firebasePrincipalMembershipClaim";
import { firestoreTtlAfter } from "../shared/firestoreTtl";

const RECEIPT_CONTEXT = "household-command";
const HOUSEHOLD_COLLECTION = "households";
const PROCESSING_LEASE_MILLIS = 60_000;

function stringField(
  value: FirebaseFirestore.DocumentData | undefined,
  field: string,
): string | undefined {
  const candidate = value?.[field];
  return typeof candidate === "string" && candidate.trim() !== ""
    ? candidate.trim()
    : undefined;
}

function stringArrayField(
  value: FirebaseFirestore.DocumentData | undefined,
  field: string,
): readonly string[] {
  const candidate = value?.[field];
  return Array.isArray(candidate)
    ? candidate.filter(
        (item): item is string => typeof item === "string" && item.trim() !== "",
      )
    : [];
}

export class Sha256HouseholdCommandHashAdapter
  implements HouseholdCommandHashPort
{
  hash(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }
}

export class FirebaseHouseholdCommandMembershipAdapter
  implements HouseholdCommandMembershipPort
{
  constructor(private readonly database: firestore.Firestore) {}

  async resolveActor(input: {
    readonly principalUid: string;
    readonly householdId: string;
  }): Promise<ResolveHouseholdActorResult> {
    const claimSnapshot = await this.database
      .collection("principalMembershipClaims")
      .doc(principalClaimId(input.principalUid))
      .get();
    if (claimSnapshot.exists) {
      const claim = claimSnapshot.data();
      const claimHouseholdId = stringField(claim, "householdId");
      const memberId = stringField(claim, "memberId");
      const lifecycleState = stringField(claim, "lifecycleState");
      if (
        claimHouseholdId !== input.householdId ||
        stringField(claim, "principalUid") !== input.principalUid ||
        memberId === undefined ||
        lifecycleState !== "active"
      ) {
        return { kind: "forbidden" };
      }
      if (
        stringField(claim, "householdLifecycleState") === "deleted" ||
        claim?.deletedAt !== undefined
      ) {
        return { kind: "household-not-active" };
      }
      const capabilities = stringArrayField(claim, "capabilities");
      return {
        kind: "active",
        actor: {
          principalUid: input.principalUid,
          householdId: input.householdId,
          actingMemberId: memberId,
          capabilities:
            capabilities.length === 0
              ? [...STANDARD_MEMBER_CAPABILITIES]
              : capabilities,
        },
      };
    }

    // 전역 claim이 없는 마이그레이션 이전 사용자만 canonical 문서를 확인합니다.
    const [membershipSnapshot, householdSnapshot] = await Promise.all([
      this.database
        .collection(HOUSEHOLD_COLLECTION)
        .doc(input.householdId)
        .collection("memberships")
        .doc(input.principalUid)
        .get(),
      this.database
        .collection(HOUSEHOLD_COLLECTION)
        .doc(input.householdId)
        .get(),
    ]);
    if (!membershipSnapshot.exists || !householdSnapshot.exists) {
      return { kind: "forbidden" };
    }

    const membership = membershipSnapshot.data();
    const household = householdSnapshot.data();
    const membershipHouseholdId = stringField(membership, "householdId");
    const memberId = stringField(membership, "memberId");
    const membershipStatus =
      stringField(membership, "lifecycleState") ??
      stringField(membership, "status") ??
      "active";
    if (
      membershipHouseholdId !== input.householdId ||
      memberId === undefined ||
      membershipStatus !== "active"
    ) {
      return { kind: "forbidden" };
    }

    const lifecycle = stringField(household, "lifecycleState") ?? "active";
    if (lifecycle !== "active" || household?.deletedAt !== undefined) {
      return { kind: "household-not-active" };
    }

    return {
      kind: "active",
      actor: {
        principalUid: input.principalUid,
        householdId: input.householdId,
        actingMemberId: memberId,
        capabilities: stringArrayField(membership, "capabilities"),
      },
    };
  }
}

interface StoredReceipt {
  readonly payloadHash?: unknown;
  readonly status?: unknown;
  readonly leaseExpiresAt?: unknown;
  readonly result?: unknown;
}

function millis(iso: string): number {
  const parsed = Date.parse(iso);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export class FirebaseHouseholdCommandReceiptAdapter
  implements HouseholdCommandReceiptPort
{
  constructor(private readonly database: firestore.Firestore) {}

  async claim(input: {
    readonly receiptId: string;
    readonly principalUid: string;
    readonly command: string;
    readonly payloadHash: string;
    readonly requestedAt: string;
  }): Promise<HouseholdCommandReceiptClaim> {
    const reference = this.database
      .collection("commandReceipts")
      .doc(RECEIPT_CONTEXT)
      .collection("receipts")
      .doc(input.receiptId);
    const now = millis(input.requestedAt);
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = snapshot.data() as StoredReceipt | undefined;
      if (current !== undefined) {
        if (current.payloadHash !== input.payloadHash) {
          return { kind: "payload-mismatch" } as const;
        }
        if (current.status === "completed" && current.result !== undefined) {
          return {
            kind: "completed",
            result: current.result as HouseholdCommandResult,
          } as const;
        }
        const leaseExpiresAt =
          typeof current.leaseExpiresAt === "string"
            ? millis(current.leaseExpiresAt)
            : Number.POSITIVE_INFINITY;
        if (leaseExpiresAt > now) return { kind: "in-progress" } as const;
      }

      transaction.set(reference, {
        principalUid: input.principalUid,
        command: input.command,
        payloadHash: input.payloadHash,
        status: "processing",
        requestedAt: input.requestedAt,
        leaseExpiresAt: new Date(now + PROCESSING_LEASE_MILLIS).toISOString(),
        schemaVersion: 1,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return { kind: "claimed" } as const;
    });
  }

  async complete(input: {
    readonly receiptId: string;
    readonly payloadHash: string;
    readonly result: HouseholdCommandResult;
    readonly completedAt: string;
  }): Promise<void> {
    const reference = this.database
      .collection("commandReceipts")
      .doc(RECEIPT_CONTEXT)
      .collection("receipts")
      .doc(input.receiptId);
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists || snapshot.data()?.payloadHash !== input.payloadHash) {
        throw new Error("Household command receipt ownership changed");
      }
      transaction.update(reference, {
        status: "completed",
        result: input.result,
        terminalAt: input.completedAt,
        completedAt: input.completedAt,
        expiresAt: firestoreTtlAfter(input.completedAt),
        leaseExpiresAt: null,
        schemaVersion: 1,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  }

  async abandon(input: {
    readonly receiptId: string;
    readonly payloadHash: string;
  }): Promise<void> {
    const reference = this.database
      .collection("commandReceipts")
      .doc(RECEIPT_CONTEXT)
      .collection("receipts")
      .doc(input.receiptId);
    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (
        snapshot.exists &&
        snapshot.data()?.payloadHash === input.payloadHash &&
        snapshot.data()?.status === "processing"
      ) {
        transaction.delete(reference);
      }
    });
  }
}

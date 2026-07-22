import type { Firestore } from "firebase-admin/firestore";

export interface SignedInUserMembershipView {
  readonly householdId: string;
  readonly memberId: string;
  readonly displayName: string;
  readonly aggregateVersion: number;
  readonly status: "active";
  readonly capabilities: readonly string[];
}

export type SignedInUserResolution =
  | {
      readonly kind: "membership-found";
      readonly membership: SignedInUserMembershipView;
    }
  | {
      readonly kind: "first-visit-required";
      readonly choices: readonly ["create", "join"];
    };

export class SignedInUserResolutionError extends Error {
  readonly name = "SignedInUserResolutionError";

  constructor(
    readonly code:
      | "HOUSEHOLD_NOT_ACTIVE"
      | "MEMBERSHIP_VIEW_INVARIANT_BROKEN"
      | "MEMBERSHIP_CANONICAL_INVARIANT_BROKEN"
      | "MEMBER_PROFILE_INVARIANT_BROKEN",
  ) {
    super(code);
  }
}

function stringField(
  value: FirebaseFirestore.DocumentData | undefined,
  field: string,
): string | undefined {
  const candidate = value?.[field];
  return typeof candidate === "string" && candidate.trim() !== ""
    ? candidate
    : undefined;
}

/**
 * Firebase Auth가 검증한 principal UID에서만 현재 active Membership을 해석합니다.
 * WebView session handoff와 공개 access command가 같은 서버 판정을 재사용합니다.
 */
export async function resolveFirebaseSignedInUser(
  database: Firestore,
  principalUid: string,
): Promise<SignedInUserResolution> {
  const snapshot = await database
    .collection("users")
    .doc(principalUid)
    .collection("householdMembershipViews")
    .where("lifecycleState", "==", "active")
    .limit(2)
    .get();
  if (snapshot.size === 0) {
    return { kind: "first-visit-required", choices: ["create", "join"] };
  }
  if (snapshot.size > 1) {
    throw new SignedInUserResolutionError(
      "MEMBERSHIP_VIEW_INVARIANT_BROKEN",
    );
  }

  const projectedMembership = snapshot.docs[0].data();
  const householdId = stringField(projectedMembership, "householdId");
  const memberId = stringField(projectedMembership, "memberId");
  if (
    householdId === undefined ||
    memberId === undefined ||
    stringField(projectedMembership, "principalUid") !== principalUid ||
    snapshot.docs[0].id !== householdId
  ) {
    throw new SignedInUserResolutionError(
      "MEMBERSHIP_VIEW_INVARIANT_BROKEN",
    );
  }

  const [canonicalMembership, member, household] = await Promise.all([
    database
      .collection("households")
      .doc(householdId)
      .collection("memberships")
      .doc(principalUid)
      .get(),
    database
      .collection("households")
      .doc(householdId)
      .collection("members")
      .doc(memberId)
      .get(),
    database.collection("households").doc(householdId).get(),
  ]);
  if (
    !household.exists ||
    household.data()?.lifecycleState === "deleted" ||
    household.data()?.deletedAt !== undefined
  ) {
    throw new SignedInUserResolutionError("HOUSEHOLD_NOT_ACTIVE");
  }

  const membershipData = canonicalMembership.data();
  const memberData = member.data();
  if (
    !canonicalMembership.exists ||
    membershipData?.lifecycleState !== "active" ||
    membershipData.status !== "active" ||
    stringField(membershipData, "principalUid") !== principalUid ||
    stringField(membershipData, "householdId") !== householdId ||
    stringField(membershipData, "memberId") !== memberId
  ) {
    throw new SignedInUserResolutionError(
      "MEMBERSHIP_CANONICAL_INVARIANT_BROKEN",
    );
  }
  if (
    !member.exists ||
    memberData?.lifecycleState !== "active" ||
    stringField(memberData, "linkedPrincipalUid") !== principalUid ||
    stringField(memberData, "householdId") !== householdId ||
    stringField(memberData, "memberId") !== memberId
  ) {
    throw new SignedInUserResolutionError("MEMBER_PROFILE_INVARIANT_BROKEN");
  }
  const displayName = stringField(memberData, "displayName");
  const aggregateVersion = memberData.aggregateVersion;
  if (
    displayName === undefined ||
    typeof aggregateVersion !== "number" ||
    !Number.isInteger(aggregateVersion) ||
    aggregateVersion < 1
  ) {
    throw new SignedInUserResolutionError("MEMBER_PROFILE_INVARIANT_BROKEN");
  }

  return {
    kind: "membership-found",
    membership: {
      householdId,
      memberId,
      displayName,
      aggregateVersion,
      status: "active",
      capabilities: Array.isArray(membershipData.capabilities)
        ? membershipData.capabilities.filter(
            (capability: unknown): capability is string => typeof capability === "string",
          )
        : [],
    },
  };
}

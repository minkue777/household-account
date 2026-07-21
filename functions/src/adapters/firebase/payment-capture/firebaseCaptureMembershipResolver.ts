import type * as firestore from "firebase-admin/firestore";

export type CaptureMembershipResolution =
  | {
      readonly kind: "active";
      readonly principalUid: string;
      readonly householdId: string;
      readonly memberId: string;
    }
  | { readonly kind: "unauthenticated"; readonly code: "AUTH_REQUIRED" }
  | {
      readonly kind: "forbidden";
      readonly code: "ACTIVE_HOUSEHOLD_MEMBERSHIP_REQUIRED";
    };

export interface CaptureMembershipResolver {
  resolve(principalUid: string | undefined): Promise<CaptureMembershipResolution>;
}

function active(data: FirebaseFirestore.DocumentData | undefined): boolean {
  return (
    data !== undefined &&
    data.lifecycleState !== "deleted" &&
    data.lifecycleState !== "removed" &&
    data.status !== "removed" &&
    data.deletedAt === undefined &&
    data.removedAt === undefined
  );
}

export class FirebaseCaptureMembershipResolver
  implements CaptureMembershipResolver
{
  constructor(private readonly database: firestore.Firestore) {}

  async resolve(
    principalUid: string | undefined,
  ): Promise<CaptureMembershipResolution> {
    if (principalUid === undefined || principalUid.trim() === "") {
      return { kind: "unauthenticated", code: "AUTH_REQUIRED" };
    }

    const views = await this.database
      .collection("users")
      .doc(principalUid)
      .collection("householdMembershipViews")
      .where("lifecycleState", "==", "active")
      .limit(2)
      .get();
    if (views.size !== 1) {
      return {
        kind: "forbidden",
        code: "ACTIVE_HOUSEHOLD_MEMBERSHIP_REQUIRED",
      };
    }

    const view = views.docs[0].data();
    const householdId =
      typeof view.householdId === "string" ? view.householdId : views.docs[0].id;
    const memberId = typeof view.memberId === "string" ? view.memberId : "";
    if (householdId.trim() === "" || memberId.trim() === "") {
      return {
        kind: "forbidden",
        code: "ACTIVE_HOUSEHOLD_MEMBERSHIP_REQUIRED",
      };
    }

    const household = this.database.collection("households").doc(householdId);
    const [householdSnapshot, membershipSnapshot, memberSnapshot] =
      await Promise.all([
        household.get(),
        household.collection("memberships").doc(principalUid).get(),
        household.collection("members").doc(memberId).get(),
      ]);
    const membership = membershipSnapshot.data();
    const canonicalMemberId =
      typeof membership?.memberId === "string" ? membership.memberId : undefined;
    if (
      !householdSnapshot.exists ||
      !membershipSnapshot.exists ||
      !memberSnapshot.exists ||
      !active(householdSnapshot.data()) ||
      !active(membership) ||
      !active(memberSnapshot.data()) ||
      canonicalMemberId !== memberId
    ) {
      return {
        kind: "forbidden",
        code: "ACTIVE_HOUSEHOLD_MEMBERSHIP_REQUIRED",
      };
    }

    return { kind: "active", principalUid, householdId, memberId };
  }
}

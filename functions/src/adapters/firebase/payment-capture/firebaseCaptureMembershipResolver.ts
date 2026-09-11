import type * as firestore from "firebase-admin/firestore";

import { principalClaimId } from "../access/firebasePrincipalMembershipClaim";

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
  resolve(
    principalUid: string | undefined,
    authToken?: Readonly<Record<string, unknown>>,
  ): Promise<CaptureMembershipResolution>;
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

function matchesNativeMembershipHint(
  authToken: Readonly<Record<string, unknown>> | undefined,
  householdId: string,
  memberId: string,
): boolean {
  if (authToken?.hcaClient !== "native") return true;
  const householdHint = authToken.hcaCaptureHouseholdId;
  const memberHint = authToken.hcaCaptureMemberId;
  // 발급 당시의 신원 힌트는 현재 권한을 승인하지 않습니다. 다른 가구나 멤버로
  // 바뀐 세션의 오래된 알림을 새 scope로 재해석하지 않는 데만 사용합니다.
  return (
    (householdHint === undefined || (typeof householdHint === "string" && householdHint.trim() === householdId)) &&
    (memberHint === undefined || (typeof memberHint === "string" && memberHint.trim() === memberId))
  );
}

export class FirebaseCaptureMembershipResolver
  implements CaptureMembershipResolver
{
  constructor(private readonly database: firestore.Firestore) {}

  async resolve(
    principalUid: string | undefined,
    authToken?: Readonly<Record<string, unknown>>,
  ): Promise<CaptureMembershipResolution> {
    principalUid = principalUid?.trim();
    if (principalUid === undefined || principalUid === "") {
      return { kind: "unauthenticated", code: "AUTH_REQUIRED" };
    }

    const claimSnapshot = await this.database
      .collection("principalMembershipClaims")
      .doc(principalClaimId(principalUid))
      .get();
    if (claimSnapshot.exists) {
      const claim = claimSnapshot.data();
      const householdId =
        typeof claim?.householdId === "string" ? claim.householdId.trim() : "";
      const memberId =
        typeof claim?.memberId === "string" ? claim.memberId.trim() : "";
      if (
        active(claim) &&
        claim?.lifecycleState === "active" &&
        claim?.householdLifecycleState !== "deleted" &&
        claim?.principalUid === principalUid &&
        householdId !== "" &&
        memberId !== "" &&
        matchesNativeMembershipHint(authToken, householdId, memberId)
      ) {
        return { kind: "active", principalUid, householdId, memberId };
      }
      return {
        kind: "forbidden",
        code: "ACTIVE_HOUSEHOLD_MEMBERSHIP_REQUIRED",
      };
    }

    // Migration 호환 경로입니다. 전역 claim이 없는 기존 데이터만 canonical
    // membership과 member를 확인하고, 정상 마이그레이션된 사용자는 위의 단일
    // 문서 조회에서 종료합니다.
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
    if (householdId.trim() === "" || memberId.trim() === "" || !matchesNativeMembershipHint(authToken, householdId, memberId)) {
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

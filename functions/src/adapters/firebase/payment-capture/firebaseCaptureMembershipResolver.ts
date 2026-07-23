import type * as firestore from "firebase-admin/firestore";

import { BoundedTtlCache } from "../../memory/boundedTtlCache";
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

export const CAPTURE_MEMBERSHIP_CACHE_TTL_MILLIS = 5 * 60 * 1_000;
export const CAPTURE_MEMBERSHIP_CACHE_MAX_ENTRIES = 64;

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

function tokenMembership(
  principalUid: string | undefined,
  authToken: Readonly<Record<string, unknown>> | undefined,
): Extract<CaptureMembershipResolution, { readonly kind: "active" }> | undefined {
  const normalizedUid = principalUid?.trim();
  if (
    normalizedUid === undefined ||
    normalizedUid === "" ||
    authToken?.hcaClient !== "native" ||
    authToken.hcaCaptureMembershipVersion !== 1 ||
    authToken.hcaCaptureMember !== true
  ) {
    return undefined;
  }
  const householdId =
    typeof authToken.hcaCaptureHouseholdId === "string"
      ? authToken.hcaCaptureHouseholdId.trim()
      : "";
  const memberId =
    typeof authToken.hcaCaptureMemberId === "string"
      ? authToken.hcaCaptureMemberId.trim()
      : "";
  return householdId === "" || memberId === ""
    ? undefined
    : {
        kind: "active",
        principalUid: normalizedUid,
        householdId,
        memberId,
      };
}

export class FirebaseCaptureMembershipResolver
  implements CaptureMembershipResolver
{
  constructor(private readonly database: firestore.Firestore) {}

  async resolve(
    principalUid: string | undefined,
    authToken?: Readonly<Record<string, unknown>>,
  ): Promise<CaptureMembershipResolution> {
    const token = tokenMembership(principalUid, authToken);
    if (token !== undefined) return token;
    if (principalUid === undefined || principalUid.trim() === "") {
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
        memberId !== ""
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

export class CachedCaptureMembershipResolver
  implements CaptureMembershipResolver
{
  private readonly cache: BoundedTtlCache<
    string,
    Extract<CaptureMembershipResolution, { readonly kind: "active" }>
  >;

  constructor(
    private readonly delegate: CaptureMembershipResolver,
    options: {
      readonly ttlMillis?: number;
      readonly maxEntries?: number;
      readonly now?: () => number;
    } = {},
  ) {
    this.cache = new BoundedTtlCache({
      ttlMillis: options.ttlMillis ?? CAPTURE_MEMBERSHIP_CACHE_TTL_MILLIS,
      maxEntries:
        options.maxEntries ?? CAPTURE_MEMBERSHIP_CACHE_MAX_ENTRIES,
      ...(options.now === undefined ? {} : { now: options.now }),
    });
  }

  async resolve(
    principalUid: string | undefined,
    authToken?: Readonly<Record<string, unknown>>,
  ): Promise<CaptureMembershipResolution> {
    const token = tokenMembership(principalUid, authToken);
    if (token !== undefined) return token;
    const normalizedUid = principalUid?.trim();
    if (normalizedUid === undefined || normalizedUid === "") {
      return this.delegate.resolve(principalUid, authToken);
    }

    const cached = this.cache.get(normalizedUid);
    if (cached !== undefined) return cached;

    const resolved = await this.delegate.resolve(normalizedUid, authToken);
    if (resolved.kind === "active") this.cache.set(normalizedUid, resolved);
    return resolved;
  }
}

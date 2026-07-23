import type * as firestore from "firebase-admin/firestore";

import { BoundedTtlCache } from "../../memory/boundedTtlCache";

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

/**
 * 활성 membership만 짧게 캐시합니다. 거부 결과를 저장하지 않으므로 신규 가입이나
 * 복구는 다음 요청에서 즉시 다시 확인하고, 삭제/전환의 최대 stale 시간은 5분입니다.
 */
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
  ): Promise<CaptureMembershipResolution> {
    const normalizedUid = principalUid?.trim();
    if (normalizedUid === undefined || normalizedUid === "") {
      return this.delegate.resolve(principalUid);
    }

    const cached = this.cache.get(normalizedUid);
    if (cached !== undefined) return cached;

    const resolved = await this.delegate.resolve(normalizedUid);
    if (resolved.kind === "active") this.cache.set(normalizedUid, resolved);
    return resolved;
  }
}

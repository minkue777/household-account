import { describe, expect, it } from "vitest";

import {
  CachedCaptureConfigurationQuery,
  CoalescingCaptureConfigurationQuery,
} from "../../../src/adapters/firebase/payment-capture/firebaseCaptureConfigurationQuery";
import {
  CachedCaptureMembershipResolver,
  type CaptureMembershipResolution,
  type CaptureMembershipResolver,
} from "../../../src/adapters/firebase/payment-capture/firebaseCaptureMembershipResolver";
import type {
  CaptureConfigurationQueryPort,
  CaptureConfigurationQueryResult,
} from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureConfigurationQueryPort";

describe("payment capture warm-instance read-through cache", () => {
  it("활성 membership만 제한 시간 동안 UID별로 재사용한다", async () => {
    let now = 0;
    let calls = 0;
    let next: CaptureMembershipResolution = {
      kind: "active",
      principalUid: "uid-1",
      householdId: "house-1",
      memberId: "member-1",
    };
    const delegate: CaptureMembershipResolver = {
      resolve: async () => {
        calls += 1;
        return next;
      },
    };
    const cache = new CachedCaptureMembershipResolver(delegate, {
      ttlMillis: 100,
      maxEntries: 2,
      now: () => now,
    });

    await expect(cache.resolve("uid-1")).resolves.toMatchObject({
      kind: "active",
      householdId: "house-1",
    });
    await cache.resolve("uid-1");
    expect(calls).toBe(1);

    now = 100;
    await cache.resolve("uid-1");
    expect(calls).toBe(2);

    next = {
      kind: "forbidden",
      code: "ACTIVE_HOUSEHOLD_MEMBERSHIP_REQUIRED",
    };
    now = 200;
    await cache.resolve("uid-1");
    await cache.resolve("uid-1");
    expect(calls).toBe(4);
  });

  it("사용 가능한 설정만 household·member 범위로 잠시 재사용한다", async () => {
    let now = 0;
    let calls = 0;
    let fail = false;
    const available: CaptureConfigurationQueryResult = {
      kind: "available",
      value: {
        cards: [],
        merchantRules: [],
        activeCategoryIds: new Set(["etc"]),
        defaultCategoryId: "etc",
      },
    };
    const delegate: CaptureConfigurationQueryPort = {
      load: async () => {
        calls += 1;
        return fail
          ? {
              kind: "retryable-failure",
              code: "PAYMENT_CONFIGURATION_UNAVAILABLE",
            }
          : available;
      },
    };
    const cache = new CachedCaptureConfigurationQuery(delegate, {
      ttlMillis: 100,
      maxEntries: 2,
      now: () => now,
    });
    const scope = { householdId: "house-1", actingMemberId: "member-1" };

    await cache.load(scope);
    await cache.load(scope);
    expect(calls).toBe(1);

    await cache.load({ ...scope, actingMemberId: "member-2" });
    expect(calls).toBe(2);

    now = 100;
    fail = true;
    await cache.load(scope);
    await cache.load(scope);
    expect(calls).toBe(4);
  });

  it("prefetch와 실제 load가 겹치면 동일한 설정 조회를 한 번만 수행한다", async () => {
    let calls = 0;
    let complete:
      | ((result: CaptureConfigurationQueryResult) => void)
      | undefined;
    const delegate: CaptureConfigurationQueryPort = {
      load: () => {
        calls += 1;
        return new Promise<CaptureConfigurationQueryResult>((resolve) => {
          complete = resolve;
        });
      },
    };
    const query = new CoalescingCaptureConfigurationQuery(delegate);
    const scope = { householdId: "house-1", actingMemberId: "member-1" };

    query.prefetch(scope);
    const loaded = query.load(scope);

    expect(calls).toBe(1);
    complete?.({
      kind: "available",
      value: {
        cards: [],
        merchantRules: [],
        activeCategoryIds: new Set(["etc"]),
        defaultCategoryId: "etc",
      },
    });
    await expect(loaded).resolves.toMatchObject({ kind: "available" });
  });
});

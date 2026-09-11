import { describe, expect, it } from "vitest";

import {
  CoalescingCaptureConfigurationQuery,
} from "../../../src/adapters/firebase/payment-capture/firebaseCaptureConfigurationQuery";
import type {
  CaptureConfigurationQueryPort,
  CaptureConfigurationQueryResult,
} from "../../../src/contexts/payment-capture/android-payment-ingestion/application/ports/out/captureConfigurationQueryPort";

describe("payment capture 동시 설정 조회 병합", () => {
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

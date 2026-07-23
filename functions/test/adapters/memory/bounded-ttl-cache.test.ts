import { describe, expect, it } from "vitest";

import { BoundedTtlCache } from "../../../src/adapters/memory/boundedTtlCache";

describe("BoundedTtlCache", () => {
  it("TTL이 지나면 값을 폐기한다", () => {
    let now = 1_000;
    const cache = new BoundedTtlCache<string, string>({
      ttlMillis: 100,
      maxEntries: 2,
      now: () => now,
    });

    cache.set("a", "value-a");
    expect(cache.get("a")).toBe("value-a");

    now = 1_100;
    expect(cache.get("a")).toBeUndefined();
  });

  it("최대 개수를 넘으면 가장 오래 사용하지 않은 값을 제거한다", () => {
    const cache = new BoundedTtlCache<string, string>({
      ttlMillis: 1_000,
      maxEntries: 2,
      now: () => 0,
    });

    cache.set("a", "value-a");
    cache.set("b", "value-b");
    expect(cache.get("a")).toBe("value-a");
    cache.set("c", "value-c");

    expect(cache.get("a")).toBe("value-a");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("value-c");
  });
});

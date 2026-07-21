import { describe, expect, it } from "vitest";

import { toHouseholdQueryWireResponse } from "../../src/bootstrap/firebaseHouseholdQuery";

describe("household query wire response", () => {
  it("성공과 거절을 versioned response envelope로 변환한다", () => {
    expect(
      toHouseholdQueryWireResponse(
        { queryId: "query-1" },
        { kind: "success", queryId: "query-1", data: { aggregateVersion: 2 } },
      ),
    ).toEqual({
      contractVersion: "household-query-response.v1",
      queryId: "query-1",
      result: { kind: "succeeded", value: { aggregateVersion: 2 } },
    });
    expect(
      toHouseholdQueryWireResponse(
        { queryId: "query-2" },
        { kind: "error", queryId: "query-2", code: "NOT_FOUND", retryable: false },
      ),
    ).toEqual({
      contractVersion: "household-query-response.v1",
      queryId: "query-2",
      result: {
        kind: "rejected",
        error: { code: "NOT_FOUND", retryable: false },
      },
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import type { https } from "firebase-functions/v1";

import { executeHouseholdQuery, toHouseholdQueryWireResponse } from "../../src/bootstrap/firebaseHouseholdQuery";
import { FirebaseHouseholdCommandMembershipAdapter } from "../../src/adapters/firebase/commands/firebaseHouseholdCommandInfrastructure";
import { FirebaseExternalQueryQuota } from "../../src/adapters/firebase/operations/firebaseExternalQueryQuota";

const marker = vi.hoisted(() => ({ releaseId: "release-smoke", commitSha: "a".repeat(40), artifactSha256: "b".repeat(64) }));
vi.mock("../../src/bootstrap/deploymentMarker", () => ({ readDeploymentMarker: () => marker }));

describe("household query wire response", () => {
  it("[REL-004] 비로그인 조회는 가구 접근 없이 거부하고 공개 배포 식별자만 반환한다", async () => {
    const membership = vi.spyOn(FirebaseHouseholdCommandMembershipAdapter.prototype, "resolveActor");
    const quota = vi.spyOn(FirebaseExternalQueryQuota.prototype, "allow");
    try {
      const response = await executeHouseholdQuery.run({
        contractVersion: "household-query.v1", queryId: "release-smoke",
        householdId: "release-smoke", query: "access.list-asset-owner-profiles.v1", payload: {},
      }, { rawRequest: { ip: "127.0.0.1" } } as unknown as https.CallableContext);

      expect(response).toEqual({
        contractVersion: "household-query-response.v1", queryId: "release-smoke",
        result: { kind: "rejected", error: { code: "AUTH_REQUIRED", retryable: false } },
        deployment: marker,
      });
      expect(membership).not.toHaveBeenCalled();
      expect(quota).not.toHaveBeenCalled();
    } finally {
      membership.mockRestore();
      quota.mockRestore();
    }
  });

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

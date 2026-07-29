import { afterEach, describe, expect, it, vi } from "vitest";

import { SignedInUserResolutionError } from "../../src/adapters/firebase/access/firebaseSignedInUserResolver";
import {
  handleCreateWebViewSessionToken,
  issueWebViewSessionToken,
} from "../../src/bootstrap/firebaseWebViewSession";

describe("WebView Firebase session bridge", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("native Firebase Auth의 동일 uid에 대해서만 custom token을 발급한다", async () => {
    const issue = vi.fn(
      async (uid: string, claims: Readonly<Record<string, unknown>>) =>
        `token-for:${uid}:${String(claims.hcaClient)}`,
    );
    const resolveSignedInUser = vi.fn(async () => ({
      kind: "membership-found" as const,
      membership: {
        householdId: "household-1",
        memberId: "member-1",
        displayName: "민규",
        aggregateVersion: 3,
        status: "active" as const,
        capabilities: ["household.read"],
      },
    }));

    await expect(
      issueWebViewSessionToken({
        principalUid: " uid-a ",
        issue,
        resolveSignedInUser,
      }),
    ).resolves.toEqual({
      contractVersion: "webview-session-token.v1",
      customToken: "token-for:uid-a:web",
      nativeCustomToken: "token-for:uid-a:native",
      principalUid: "uid-a",
      signedInUserResolution: {
        kind: "membership-found",
        membership: {
          householdId: "household-1",
          memberId: "member-1",
          displayName: "민규",
          aggregateVersion: 3,
          status: "active",
          capabilities: ["household.read"],
        },
      },
    });
    expect(issue).toHaveBeenNthCalledWith(
      1,
      "uid-a",
      expect.objectContaining({
        hcaClient: "web",
        hcaCaptureMember: true,
        hcaCaptureHouseholdId: "household-1",
        hcaCaptureMemberId: "member-1",
      }),
    );
    expect(issue).toHaveBeenNthCalledWith(
      2,
      "uid-a",
      expect.objectContaining({
        hcaClient: "native",
        hcaCaptureMember: true,
        hcaCaptureHouseholdId: "household-1",
        hcaCaptureMemberId: "member-1",
      }),
    );
    expect(resolveSignedInUser).toHaveBeenCalledWith("uid-a");
  });

  it("Membership 조회 실패를 token-only 성공으로 숨기지 않는다", async () => {
    const issue = vi.fn(async () => "token-for:uid-a");
    await expect(
      issueWebViewSessionToken({
        principalUid: "uid-a",
        issue,
        resolveSignedInUser: async () => {
          throw new Error("temporary-read-failure");
        },
      }),
    ).rejects.toThrow("temporary-read-failure");
    expect(issue).not.toHaveBeenCalled();
  });

  it("인증되지 않은 호출에는 token issuer를 호출하지 않는다", async () => {
    const issue = vi.fn(async () => "must-not-be-issued");
    const resolveSignedInUser = vi.fn();

    await expect(
      issueWebViewSessionToken({
        principalUid: undefined,
        issue,
        resolveSignedInUser,
      }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(issue).not.toHaveBeenCalled();
    expect(resolveSignedInUser).not.toHaveBeenCalled();
  });

  it("callable adapter는 발급 결과를 그대로 반환한다", async () => {
    await expect(
      handleCreateWebViewSessionToken({
        principalUid: "uid-a",
        issue: async (_principalUid, claims) =>
          `token-for:${String(claims.hcaClient)}`,
        resolveSignedInUser: async () => ({
          kind: "first-visit-required",
          choices: ["create", "join"],
        }),
      }),
    ).resolves.toMatchObject({
      customToken: "token-for:web",
      nativeCustomToken: "token-for:native",
    });
  });

  it("callable adapter도 인증되지 않은 요청을 거부한다", async () => {
    await expect(
      handleCreateWebViewSessionToken({
        principalUid: undefined,
        issue: async () => "must-not-be-issued",
        resolveSignedInUser: async () => ({
          kind: "first-visit-required",
          choices: ["create", "join"],
        }),
      }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("회원 해석 불변식 오류와 예기치 않은 오류를 구분한다", async () => {
    await expect(
      handleCreateWebViewSessionToken({
        principalUid: "uid-a",
        issue: async () => "must-not-be-issued",
        resolveSignedInUser: async () => {
          throw new SignedInUserResolutionError("HOUSEHOLD_NOT_ACTIVE");
        },
      }),
    ).rejects.toMatchObject({
      code: "failed-precondition",
      message: "HOUSEHOLD_NOT_ACTIVE",
    });

    await expect(
      handleCreateWebViewSessionToken({
        principalUid: "uid-a",
        issue: async () => "must-not-be-issued",
        resolveSignedInUser: async () => {
          throw new Error("temporary-read-failure");
        },
      }),
    ).rejects.toMatchObject({
      code: "unavailable",
      message: "SIGNED_IN_USER_RESOLUTION_FAILED",
    });
  });
});

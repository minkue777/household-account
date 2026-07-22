import { describe, expect, it, vi } from "vitest";

import { issueWebViewSessionToken } from "../../src/bootstrap/firebaseWebViewSession";

describe("WebView Firebase session bridge", () => {
  it("native Firebase Auth의 동일 uid에 대해서만 custom token을 발급한다", async () => {
    const issue = vi.fn(async (uid: string) => `token-for:${uid}`);
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
      customToken: "token-for:uid-a",
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
    expect(issue).toHaveBeenCalledWith("uid-a");
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
    expect(issue).toHaveBeenCalledWith("uid-a");
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
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { SignedInUserResolutionError } from "../../src/adapters/firebase/access/firebaseSignedInUserResolver";
import {
  handleCreateWebViewSessionToken,
  issueWebViewSessionToken,
} from "../../src/bootstrap/firebaseWebViewSession";

describe("[T-WEBVIEW-001][AND-005] 실제 WebView Firebase session 발급 계약", () => {
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

  it("최초 방문자도 같은 UID로 로그인하되 가구 권한 없이 생성·참여로 안내한다", async () => {
    const issue = vi.fn(
      async (_principalUid: string, claims: Readonly<Record<string, unknown>>) =>
        `token-for:${String(claims.hcaClient)}`,
    );
    await expect(
      handleCreateWebViewSessionToken({
        principalUid: "uid-a",
        issue,
        resolveSignedInUser: async () => ({
          kind: "first-visit-required",
          choices: ["create", "join"],
        }),
      }),
    ).resolves.toEqual({
      contractVersion: "webview-session-token.v1",
      customToken: "token-for:web",
      nativeCustomToken: "token-for:native",
      principalUid: "uid-a",
      signedInUserResolution: {
        kind: "first-visit-required",
        choices: ["create", "join"],
      },
    });
    expect(issue.mock.calls).toEqual([
      ["uid-a", {
        hcaClient: "web",
        hcaCaptureMembershipVersion: 1,
        hcaCaptureMember: false,
      }],
      ["uid-a", {
        hcaClient: "native",
        hcaCaptureMembershipVersion: 1,
        hcaCaptureMember: false,
      }],
    ]);
  });

  it.each(["web", "native"])(
    "%s token 발급에 실패하면 부분 성공이나 SDK 오류 원문을 반환하지 않는다",
    async (failedClient) => {
      const issue = vi.fn(
        async (_principalUid: string, claims: Readonly<Record<string, unknown>>) => {
          if (claims.hcaClient === failedClient) {
            throw new Error("internal-signer-error: private-diagnostic");
          }
          return "successfully-issued-token";
        },
      );
      await expect(
        handleCreateWebViewSessionToken({
          principalUid: "uid-a",
          issue,
          resolveSignedInUser: async () => ({
            kind: "first-visit-required",
            choices: ["create", "join"],
          }),
        }),
      ).rejects.toMatchObject({
        code: "unavailable",
        message: "SIGNED_IN_USER_RESOLUTION_FAILED",
        details: undefined,
      });
      expect(issue).toHaveBeenCalledTimes(2);
    },
  );

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

import { describe, expect, it, vi } from "vitest";

import { issueWebViewSessionToken } from "../../src/bootstrap/firebaseWebViewSession";

describe("WebView Firebase session bridge", () => {
  it("native Firebase Auth의 동일 uid에 대해서만 custom token을 발급한다", async () => {
    const issue = vi.fn(async (uid: string) => `token-for:${uid}`);

    await expect(
      issueWebViewSessionToken({ principalUid: " uid-a ", issue }),
    ).resolves.toEqual({
      contractVersion: "webview-session-token.v1",
      customToken: "token-for:uid-a",
    });
    expect(issue).toHaveBeenCalledWith("uid-a");
  });

  it("인증되지 않은 호출에는 token issuer를 호출하지 않는다", async () => {
    const issue = vi.fn(async () => "must-not-be-issued");

    await expect(
      issueWebViewSessionToken({ principalUid: undefined, issue }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(issue).not.toHaveBeenCalled();
  });
});

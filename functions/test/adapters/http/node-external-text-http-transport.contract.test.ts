import { afterEach, describe, expect, it, vi } from "vitest";

import { NodeExternalTextHttpTransport } from "../../../src/adapters/http/nodeExternalTextHttpTransport";

function responseWithCookies(): Response {
  const headers = new Headers({ "Content-Type": "text/plain; charset=UTF-8" });
  headers.append("Set-Cookie", "visitor=first; Path=/");
  headers.append("Set-Cookie", "JSESSIONID=value=with=equals; Path=/; HttpOnly");
  return new Response("ok", { status: 200, headers });
}

describe("Node external text HTTP transport 계약", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opt-in 요청에서 복수 Set-Cookie를 합치지 않고 보존한다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => responseWithCookies()));

    await expect(
      new NodeExternalTextHttpTransport().execute({
        url: "https://kind.krx.co.kr/path",
        method: "GET",
        headers: {},
        timeoutMs: 1_000,
        maxResponseBytes: 1_024,
        captureSetCookies: true,
      }),
    ).resolves.toMatchObject({
      kind: "response",
      status: 200,
      body: "ok",
      setCookieHeaders: [
        "visitor=first; Path=/",
        "JSESSIONID=value=with=equals; Path=/; HttpOnly",
      ],
    });
  });

  it("기본 요청에서는 Set-Cookie를 결과에 노출하지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => responseWithCookies()));

    const result = await new NodeExternalTextHttpTransport().execute({
      url: "https://kind.krx.co.kr/path",
      method: "GET",
      headers: {},
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
    });

    expect(result).not.toHaveProperty("setCookieHeaders");
  });
});

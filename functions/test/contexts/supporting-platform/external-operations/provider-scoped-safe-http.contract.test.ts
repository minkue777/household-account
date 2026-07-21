import { describe, expect, it } from "vitest";
import { createProviderScopedSafeHttpFixture } from "../../../support/provider-scoped-safe-http-fixture";

interface ProviderNetworkPolicy {
  provider: string;
  allowedHosts: readonly string[];
  allowedPorts: readonly number[];
  maxRedirectHops: number;
}

type ProviderResponseStep =
  | { kind: "response"; status: 200; bodyBytes: number }
  | { kind: "redirect"; location: string };

type ProviderScopedHttpResult =
  | {
      kind: "success";
      provider: string;
      finalUrl: string;
      redirectHops: number;
      responseBytes: number;
    }
  | {
      kind: "security-policy-violation";
      code:
        | "HTTPS_REQUIRED"
        | "PROVIDER_HOST_NOT_ALLOWED"
        | "PORT_NOT_ALLOWED"
        | "REDIRECT_LIMIT_EXCEEDED";
      blockedUrl: string;
      networkAttempts: number;
    };

interface ProviderScopedSafeHttpFixture {
  policies: readonly ProviderNetworkPolicy[];
  scripts: Readonly<Record<string, readonly ProviderResponseStep[]>>;
}

/** Provider마다 분리된 host/port와 redirect hop 한도의 공개 HTTP 계약입니다. */
export interface ProviderScopedSafeHttpSubject {
  get(input: {
    provider: string;
    url: string;
  }): Promise<ProviderScopedHttpResult>;
}

export function createSubject(
  _fixture: ProviderScopedSafeHttpFixture,
): ProviderScopedSafeHttpSubject {
  return createProviderScopedSafeHttpFixture(_fixture);
}

const policies: readonly ProviderNetworkPolicy[] = [
  {
    provider: "naver",
    allowedHosts: ["api.naver.test"],
    allowedPorts: [443],
    maxRedirectHops: 2,
  },
  {
    provider: "miraeasset",
    allowedHosts: ["investments.miraeasset.test"],
    allowedPorts: [443],
    maxRedirectHops: 2,
  },
];

describe("Provider별 SafeExternalHttpClient ACL 계약", () => {
  it("[T-EXT-003][EXT-003] allowlist host라도 비허용 port면 network 전에 거부한다", async () => {
    expect(
      await createSubject({ policies, scripts: {} }).get({
        provider: "naver",
        url: "https://api.naver.test:8443/quote",
      }),
    ).toEqual({
      kind: "security-policy-violation",
      code: "PORT_NOT_ALLOWED",
      blockedUrl: "https://api.naver.test:8443/quote",
      networkAttempts: 0,
    });
  });

  it("[T-EXT-003][EXT-003] 다른 Provider에 허용된 host를 현재 Provider가 공유해서 사용할 수 없다", async () => {
    expect(
      await createSubject({ policies, scripts: {} }).get({
        provider: "naver",
        url: "https://investments.miraeasset.test/fund",
      }),
    ).toEqual({
      kind: "security-policy-violation",
      code: "PROVIDER_HOST_NOT_ALLOWED",
      blockedUrl: "https://investments.miraeasset.test/fund",
      networkAttempts: 0,
    });
  });

  it("[T-EXT-003][EXT-003] redirect 각 hop을 같은 Provider ACL로 재검증한다", async () => {
    const start = "https://api.naver.test/start";
    const result = await createSubject({
      policies,
      scripts: {
        [start]: [
          {
            kind: "redirect",
            location: "https://investments.miraeasset.test/fund",
          },
        ],
      },
    }).get({ provider: "naver", url: start });

    expect(result).toEqual({
      kind: "security-policy-violation",
      code: "PROVIDER_HOST_NOT_ALLOWED",
      blockedUrl: "https://investments.miraeasset.test/fund",
      networkAttempts: 1,
    });
  });

  it("[T-EXT-003][EXT-003] redirect loop·최대 hop 초과를 유한한 결과로 종료한다", async () => {
    const first = "https://api.naver.test/first";
    const second = "https://api.naver.test/second";
    const third = "https://api.naver.test/third";
    const fourth = "https://api.naver.test/fourth";
    const result = await createSubject({
      policies,
      scripts: {
        [first]: [{ kind: "redirect", location: second }],
        [second]: [{ kind: "redirect", location: third }],
        [third]: [{ kind: "redirect", location: fourth }],
      },
    }).get({ provider: "naver", url: first });

    expect(result).toEqual({
      kind: "security-policy-violation",
      code: "REDIRECT_LIMIT_EXCEEDED",
      blockedUrl: fourth,
      networkAttempts: 3,
    });
  });

  it("[T-EXT-003][EXT-003] Provider ACL 안의 유한 redirect는 최종 URL과 hop 수를 보존한다", async () => {
    const first = "https://api.naver.test/first";
    const finalUrl = "https://api.naver.test/final";
    const result = await createSubject({
      policies,
      scripts: {
        [first]: [{ kind: "redirect", location: finalUrl }],
        [finalUrl]: [{ kind: "response", status: 200, bodyBytes: 128 }],
      },
    }).get({ provider: "naver", url: first });

    expect(result).toEqual({
      kind: "success",
      provider: "naver",
      finalUrl,
      redirectHops: 1,
      responseBytes: 128,
    });
  });
});

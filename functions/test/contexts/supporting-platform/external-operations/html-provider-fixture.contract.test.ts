import { describe, expect, it } from "vitest";

import { createHtmlProviderFixture } from "../../../support/html-provider-fixture";

type HtmlProviderResult =
  | {
      kind: "success";
      value: {
        instrumentCode: string;
        priceInWon: number;
        asOfDate: string;
      };
      selectorContractVersion: 1;
    }
  | { kind: "no-data"; code: "PRICE_NOT_PUBLISHED" }
  | { kind: "contract-failure"; code: "HTML_SELECTOR_CONTRACT_CHANGED" }
  | { kind: "invalid-data"; code: "HTML_PRICE_INVALID" };

interface HtmlProviderAttempt {
  provider: string;
  operation: "quote-html-parse";
  resultKind: HtmlProviderResult["kind"];
  code?: string;
  selectorContractVersion: 1;
  payloadFingerprint: string;
}

/** 민감정보를 제거한 HTML fixture와 selector drift 분류 계약입니다. */
export interface HtmlProviderFixtureSubject {
  parseQuote(input: {
    provider: "domestic-html-provider";
    instrumentCode: string;
    html: string;
    observedOn: string;
  }): HtmlProviderResult;
  attempts(): readonly HtmlProviderAttempt[];
}

export function createSubject(): HtmlProviderFixtureSubject {
  return createHtmlProviderFixture();
}

const validFixture = `
<!doctype html>
<html lang="ko">
  <body>
    <section data-contract="quote-v1">
      <span data-field="instrument-code">005930</span>
      <strong data-field="price">81,200</strong>
      <time data-field="as-of">2026-07-20</time>
    </section>
  </body>
</html>`;

describe("HTML scraping fixture·selector drift 계약", () => {
  it("[T-EXT-004][EXT-001] 정제된 정상 HTML fixture를 provider 중립 값과 구조화 attempt로 변환한다", () => {
    const subject = createSubject();

    expect(
      subject.parseQuote({
        provider: "domestic-html-provider",
        instrumentCode: "005930",
        html: validFixture,
        observedOn: "2026-07-20",
      }),
    ).toEqual({
      kind: "success",
      value: {
        instrumentCode: "005930",
        priceInWon: 81_200,
        asOfDate: "2026-07-20",
      },
      selectorContractVersion: 1,
    });
    expect(subject.attempts()).toEqual([
      {
        provider: "domestic-html-provider",
        operation: "quote-html-parse",
        resultKind: "success",
        selectorContractVersion: 1,
        payloadFingerprint: expect.any(String),
      },
    ]);
    expect(subject.attempts()[0]?.payloadFingerprint).not.toContain("81,200");
  });

  it("[T-EXT-004][EXT-001] 명시적으로 공시되지 않은 가격은 selector 실패와 구분한다", () => {
    const subject = createSubject();
    const noDataFixture = validFixture
      .replace('data-contract="quote-v1"', 'data-contract="quote-v1" data-state="price-not-published"')
      .replace('<strong data-field="price">81,200</strong>', "");

    expect(
      subject.parseQuote({
        provider: "domestic-html-provider",
        instrumentCode: "005930",
        html: noDataFixture,
        observedOn: "2026-07-20",
      }),
    ).toEqual({ kind: "no-data", code: "PRICE_NOT_PUBLISHED" });
  });

  it("[T-EXT-004][EXT-001] 유효한 0원은 데이터 부재나 비정상 숫자로 바꾸지 않는다", () => {
    const subject = createSubject();

    expect(
      subject.parseQuote({
        provider: "domestic-html-provider",
        instrumentCode: "005930",
        html: validFixture.replace("81,200", "0"),
        observedOn: "2026-07-20",
      }),
    ).toEqual({
      kind: "success",
      value: {
        instrumentCode: "005930",
        priceInWon: 0,
        asOfDate: "2026-07-20",
      },
      selectorContractVersion: 1,
    });
  });

  it("[T-EXT-004][EXT-001] selector가 바뀐 HTML을 NoData나 0원 성공으로 축약하지 않는다", () => {
    const subject = createSubject();
    const changedFixture = validFixture
      .replace('data-contract="quote-v1"', 'data-contract="quote-v2"')
      .replace('data-field="price"', 'data-field="current-price"');

    expect(
      subject.parseQuote({
        provider: "domestic-html-provider",
        instrumentCode: "005930",
        html: changedFixture,
        observedOn: "2026-07-20",
      }),
    ).toEqual({
      kind: "contract-failure",
      code: "HTML_SELECTOR_CONTRACT_CHANGED",
    });
    expect(subject.attempts()).toEqual([
      expect.objectContaining({
        resultKind: "contract-failure",
        code: "HTML_SELECTOR_CONTRACT_CHANGED",
        selectorContractVersion: 1,
      }),
    ]);
  });

  it.each(["NaN", "Infinity", "-1"])(
    "[T-EXT-004][EXT-001] 비정상 가격 %s fixture는 invalid-data이며 성공 attempt를 남기지 않는다",
    (price) => {
      const subject = createSubject();
      const invalidFixture = validFixture.replace("81,200", price);

      expect(
        subject.parseQuote({
          provider: "domestic-html-provider",
          instrumentCode: "005930",
          html: invalidFixture,
          observedOn: "2026-07-20",
        }),
      ).toEqual({ kind: "invalid-data", code: "HTML_PRICE_INVALID" });
      expect(subject.attempts()).toEqual([
        expect.objectContaining({
          resultKind: "invalid-data",
          code: "HTML_PRICE_INVALID",
        }),
      ]);
    },
  );
});

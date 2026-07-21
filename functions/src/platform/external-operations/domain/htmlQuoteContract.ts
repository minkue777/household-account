export type HtmlQuoteParseResult =
  | {
      readonly kind: "success";
      readonly value: {
        readonly instrumentCode: string;
        readonly priceInWon: number;
        readonly asOfDate: string;
      };
      readonly selectorContractVersion: 1;
    }
  | { readonly kind: "no-data"; readonly code: "PRICE_NOT_PUBLISHED" }
  | {
      readonly kind: "contract-failure";
      readonly code: "HTML_SELECTOR_CONTRACT_CHANGED";
    }
  | { readonly kind: "invalid-data"; readonly code: "HTML_PRICE_INVALID" };

const CONTRACT_MARKER = /<section\b[^>]*\bdata-contract=["']quote-v1["'][^>]*>/i;

function fieldValue(html: string, field: string): string | undefined {
  const pattern = new RegExp(
    `<[^>]+\\bdata-field=["']${field}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "i",
  );
  const match = pattern.exec(html);
  return match?.[1]?.replace(/<[^>]*>/g, "").trim();
}

function hasNoDataMarker(html: string): boolean {
  return /\bdata-state=["']price-not-published["']/i.test(html);
}

export function parseHtmlQuoteContract(input: {
  readonly instrumentCode: string;
  readonly html: string;
  readonly observedOn: string;
}): HtmlQuoteParseResult {
  if (!CONTRACT_MARKER.test(input.html)) {
    return {
      kind: "contract-failure",
      code: "HTML_SELECTOR_CONTRACT_CHANGED",
    };
  }

  if (hasNoDataMarker(input.html)) {
    return { kind: "no-data", code: "PRICE_NOT_PUBLISHED" };
  }

  const instrumentCode = fieldValue(input.html, "instrument-code");
  const priceText = fieldValue(input.html, "price");
  const asOfDate = fieldValue(input.html, "as-of");
  if (instrumentCode === undefined || priceText === undefined || asOfDate === undefined) {
    return {
      kind: "contract-failure",
      code: "HTML_SELECTOR_CONTRACT_CHANGED",
    };
  }

  const normalizedPrice = priceText.replace(/,/g, "");
  const priceInWon = Number(normalizedPrice);
  if (
    normalizedPrice.length === 0 ||
    !Number.isFinite(priceInWon) ||
    priceInWon < 0
  ) {
    return { kind: "invalid-data", code: "HTML_PRICE_INVALID" };
  }

  return {
    kind: "success",
    value: {
      instrumentCode,
      priceInWon,
      asOfDate,
    },
    selectorContractVersion: 1,
  };
}

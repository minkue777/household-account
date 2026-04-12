const NAVER_GOLD_URL = 'https://m.stock.naver.com/marketindex/metals/M04020000';

export interface NaverGoldMarketData {
  pricePerGram: number;
  previousClosePerGram: number;
  timestamp: string;
}

interface NaverGoldNextDataQuery {
  state?: {
    data?: {
      result?: {
        localTradedAt?: string;
        closePrice?: string;
        marketIndexTotalInfos?: Array<{
          code?: string;
          key?: string;
          value?: string;
        }>;
      };
    };
  };
}

function parseNumber(value: string) {
  return parseInt(value.replace(/,/g, ''), 10);
}

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseNextDataMarketData(html: string): NaverGoldMarketData | null {
  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );

  if (!nextDataMatch?.[1]) {
    return null;
  }

  try {
    const nextData = JSON.parse(nextDataMatch[1]) as {
      props?: {
        pageProps?: {
          dehydratedState?: {
            queries?: NaverGoldNextDataQuery[];
          };
        };
      };
    };

    const queries = nextData.props?.pageProps?.dehydratedState?.queries ?? [];
    const marketData = queries
      .map((query) => query.state?.data?.result)
      .find((result) => result?.closePrice && Array.isArray(result.marketIndexTotalInfos));

    if (!marketData?.closePrice) {
      return null;
    }

    const previousClose = marketData.marketIndexTotalInfos?.find(
      (info) => info.code === 'lastClosePrice' || info.key === '전일'
    )?.value;

    const pricePerGram = parseNumber(marketData.closePrice);
    const previousClosePerGram = previousClose ? parseNumber(previousClose) : NaN;

    if (!isValidNumber(pricePerGram) || !isValidNumber(previousClosePerGram)) {
      return null;
    }

    return {
      pricePerGram,
      previousClosePerGram,
      timestamp: marketData.localTradedAt || new Date().toISOString(),
    };
  } catch (error) {
    console.error('Failed to parse Naver gold __NEXT_DATA__:', error);
    return null;
  }
}

const PRICE_REGEX = /<strong[^>]*>\uAD6D\uB0B4\s+\uAE08<\/strong>[\s\S]*?<strong[^>]*>([\d,]+)<span[^>]*>\uC6D0\/g<\/span><\/strong>/;
const PREVIOUS_CLOSE_REGEX = /<span[^>]*>\uC804\uC77C<\/span><span[^>]*>([\d,]+)<\/span>/;
const DATE_REGEX = /<time>(\d{2}\.\d{2})\.<\/time><span[^>]*>\uC7A5\uB9C8\uAC10<\/span>[\s\S]*?<span[^>]*>KRX\s+\uAE08\uC2DC\uC7A5<\/span>/;

function parseHtmlMarketData(html: string): NaverGoldMarketData | null {
  const priceMatch = html.match(PRICE_REGEX);
  const previousCloseMatch = html.match(PREVIOUS_CLOSE_REGEX);
  const dateMatch = html.match(DATE_REGEX);

  if (!priceMatch?.[1] || !previousCloseMatch?.[1]) {
    return null;
  }

  const now = new Date();
  const timestamp = dateMatch?.[1]
    ? `${now.getFullYear()}-${dateMatch[1].replace('.', '-')}`
    : now.toISOString();

  return {
    pricePerGram: parseNumber(priceMatch[1]),
    previousClosePerGram: parseNumber(previousCloseMatch[1]),
    timestamp,
  };
}

export async function fetchNaverGoldMarketData(): Promise<NaverGoldMarketData | null> {
  try {
    const response = await fetch(NAVER_GOLD_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return parseNextDataMarketData(html) ?? parseHtmlMarketData(html);
  } catch (error) {
    console.error('Failed to fetch Naver gold market data:', error);
    return null;
  }
}

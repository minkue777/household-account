const NAVER_GOLD_URL = 'https://m.stock.naver.com/marketindex/metals/M04020000';

export interface NaverGoldMarketData {
  pricePerGram: number;
  previousClosePerGram: number;
  timestamp: string;
}

function parseNumber(value: string) {
  return parseInt(value.replace(/,/g, ''), 10);
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
    const priceMatch = html.match(/([\d,]+)\s*원\/g/);
    const previousCloseMatch = html.match(/전일\s*([\d,]+)/);
    const dateMatch = html.match(/(\d{2}\.\d{2})\.장마감 KRX 금시장/);

    if (!priceMatch || !previousCloseMatch) {
      return null;
    }

    const now = new Date();
    const timestamp = dateMatch
      ? `${now.getFullYear()}-${dateMatch[1].replace('.', '-')}`
      : now.toISOString();

    return {
      pricePerGram: parseNumber(priceMatch[1]),
      previousClosePerGram: parseNumber(previousCloseMatch[1]),
      timestamp,
    };
  } catch (error) {
    console.error('네이버 금 시세 조회 오류:', error);
    return null;
  }
}

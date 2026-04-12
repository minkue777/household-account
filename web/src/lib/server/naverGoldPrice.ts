const NAVER_GOLD_URL = 'https://m.stock.naver.com/marketindex/metals/M04020000';

export interface NaverGoldMarketData {
  pricePerGram: number;
  previousClosePerGram: number;
  timestamp: string;
}

function parseNumber(value: string) {
  return parseInt(value.replace(/,/g, ''), 10);
}

const PRICE_REGEX = /<strong[^>]*>\uAD6D\uB0B4\s+\uAE08<\/strong>[\s\S]*?<strong[^>]*>([\d,]+)<span[^>]*>\uC6D0\/g<\/span><\/strong>/;
const PREVIOUS_CLOSE_REGEX = /<span[^>]*>\uC804\uC77C<\/span><span[^>]*>([\d,]+)<\/span>/;
const DATE_REGEX = /<time>(\d{2}\.\d{2})\.<\/time><span[^>]*>\uC7A5\uB9C8\uAC10<\/span>[\s\S]*?<span[^>]*>KRX\s+\uAE08\uC2DC\uC7A5<\/span>/;

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
  } catch (error) {
    console.error('Failed to fetch Naver gold market data:', error);
    return null;
  }
}

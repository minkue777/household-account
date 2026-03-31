const NAVER_USD_KRW_URL =
  'https://finance.naver.com/marketindex/exchangeDetail.naver?marketindexCd=FX_USDKRW';

interface CachedUsdKrwRate {
  fetchedAt: number;
  rate: number;
}

const CACHE_TTL_MS = 1000 * 60 * 5;
let cachedRate: CachedUsdKrwRate | null = null;

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeNumberText(value: string) {
  return value.replace(/\s+/g, '');
}

function parseDecimalNumber(value: string) {
  const normalized = value.replace(/,/g, '');
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function fetchUsdKrwRate(): Promise<number | null> {
  if (cachedRate && Date.now() - cachedRate.fetchedAt < CACHE_TTL_MS) {
    return cachedRate.rate;
  }

  try {
    const response = await fetch(NAVER_USD_KRW_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    const todayPriceBlock = html.match(/<p class="no_today">([\s\S]*?)<\/p>/);
    if (!todayPriceBlock) {
      return null;
    }

    const parsedRate = parseDecimalNumber(
      normalizeNumberText(stripHtml(todayPriceBlock[1])).match(/([\d,]+\.\d+)/)?.[1] || ''
    );

    if (!parsedRate) {
      return null;
    }

    cachedRate = {
      fetchedAt: Date.now(),
      rate: parsedRate,
    };

    return parsedRate;
  } catch (error) {
    console.error('Failed to fetch USD/KRW rate:', error);
    return null;
  }
}

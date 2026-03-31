import { NextRequest, NextResponse } from 'next/server';
import { fetchNaverGoldMarketData } from '@/lib/server/naverGoldPrice';
import { fetchUsdKrwRate } from '@/lib/server/naverUsdKrwRate';
import { getUsStockSymbol } from '@/lib/server/usStockSymbols';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface StockPriceResult {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  currency: string;
  sourcePrice?: number;
  sourcePreviousClose?: number;
  sourceCurrency?: string;
  exchangeRate?: number;
}

interface NaverStockResponse {
  stockName: string;
  closePrice: string;
  compareToPreviousClosePrice: string;
  fluctuationsRatio: string;
}

interface NasdaqQuoteResponse {
  data?: {
    companyName?: string;
    primaryData?: {
      lastSalePrice?: string;
      netChange?: string;
      percentageChange?: string;
    };
    secondaryData?: {
      lastSalePrice?: string;
      netChange?: string;
      percentageChange?: string;
    };
  };
}

const GOLD_SPOT_CODES: Record<string, string> = {
  KRXGOLD1KG: '금 99.99_1kg',
  KRXGOLD100G: '미니금 99.99_100g',
};

const CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

const NASDAQ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://www.nasdaq.com',
  Referer: 'https://www.nasdaq.com/',
};

function parseInteger(value: string) {
  return parseInt(value.replace(/,/g, ''), 10);
}

function parseDecimalNumber(value?: string | null) {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^0-9.+-]/g, '');
  if (!normalized || normalized === '+' || normalized === '-') {
    return null;
  }

  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchNaverStock(code: string): Promise<StockPriceResult | null> {
  try {
    const response = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    const data: NaverStockResponse = await response.json();
    const price = parseInteger(data.closePrice);
    const change = parseInteger(data.compareToPreviousClosePrice);
    const changePercent = parseFloat(data.fluctuationsRatio);
    const previousClose = price - change;

    return {
      code,
      name: data.stockName,
      price,
      change,
      changePercent,
      previousClose,
      currency: 'KRW',
    };
  } catch (error) {
    console.error(`Failed to fetch Naver stock price (${code}):`, error);
    return null;
  }
}

async function fetchKrGoldSpot(code: string): Promise<StockPriceResult | null> {
  try {
    const marketData = await fetchNaverGoldMarketData();
    if (!marketData) {
      return null;
    }

    const price = marketData.pricePerGram;
    const previousClose = marketData.previousClosePerGram;

    return {
      code,
      name: GOLD_SPOT_CODES[code],
      price,
      change: price - previousClose,
      changePercent: previousClose > 0 ? ((price - previousClose) / previousClose) * 100 : 0,
      previousClose,
      currency: 'KRW',
    };
  } catch (error) {
    console.error(`Failed to fetch KRX gold spot price (${code}):`, error);
    return null;
  }
}

async function fetchNasdaqQuote(symbol: string, assetClass: 'stock' | 'etf') {
  const response = await fetch(
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/info?assetclass=${
      assetClass === 'etf' ? 'etf' : 'stocks'
    }`,
    {
      headers: NASDAQ_HEADERS,
      cache: 'no-store',
    }
  );

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as NasdaqQuoteResponse;
  return payload.data || null;
}

async function fetchUsStock(code: string): Promise<StockPriceResult | null> {
  const symbol = code.replace(/^US:/, '').trim().toUpperCase();
  if (!symbol) {
    return null;
  }

  try {
    const symbolInfo = await getUsStockSymbol(symbol);
    const candidateAssetClasses: Array<'stock' | 'etf'> = symbolInfo
      ? [symbolInfo.assetClass, symbolInfo.assetClass === 'etf' ? 'stock' : 'etf']
      : ['stock', 'etf'];

    let quoteData: NonNullable<NasdaqQuoteResponse['data']> | null = null;

    for (const assetClass of candidateAssetClasses) {
      quoteData = await fetchNasdaqQuote(symbol, assetClass);
      if (quoteData) {
        break;
      }
    }

    if (!quoteData) {
      return null;
    }

    const primaryPrice = parseDecimalNumber(quoteData.primaryData?.lastSalePrice);
    const secondaryPrice = parseDecimalNumber(quoteData.secondaryData?.lastSalePrice);
    const primaryNetChange = parseDecimalNumber(quoteData.primaryData?.netChange);
    const secondaryNetChange = parseDecimalNumber(quoteData.secondaryData?.netChange);
    const primaryChangePercent = parseDecimalNumber(quoteData.primaryData?.percentageChange);
    const secondaryChangePercent = parseDecimalNumber(quoteData.secondaryData?.percentageChange);

    const sourcePrice = primaryPrice ?? secondaryPrice;
    const sourcePreviousClose =
      secondaryPrice ??
      (sourcePrice !== null && primaryNetChange !== null ? sourcePrice - primaryNetChange : null) ??
      (sourcePrice !== null && secondaryNetChange !== null ? sourcePrice - secondaryNetChange : null);

    if (sourcePrice === null || sourcePreviousClose === null) {
      return null;
    }

    const exchangeRate = await fetchUsdKrwRate();
    if (!exchangeRate) {
      return null;
    }

    const price = Math.round(sourcePrice * exchangeRate);
    const previousClose = Math.round(sourcePreviousClose * exchangeRate);
    const change = price - previousClose;
    const changePercent =
      sourcePreviousClose > 0
        ? ((sourcePrice - sourcePreviousClose) / sourcePreviousClose) * 100
        : primaryChangePercent ?? secondaryChangePercent ?? 0;

    return {
      code,
      name: quoteData.companyName || symbolInfo?.name || symbol,
      price,
      change,
      changePercent,
      previousClose,
      currency: 'KRW',
      sourcePrice,
      sourcePreviousClose,
      sourceCurrency: 'USD',
      exchangeRate,
    };
  } catch (error) {
    console.error(`Failed to fetch US stock price (${code}):`, error);
    return null;
  }
}

async function fetchStockPrice(code: string) {
  if (GOLD_SPOT_CODES[code]) {
    return fetchKrGoldSpot(code);
  }

  if (code.startsWith('US:')) {
    return fetchUsStock(code);
  }

  return fetchNaverStock(code);
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');

  if (!code) {
    return NextResponse.json({ error: '종목코드가 필요합니다.' }, { status: 400 });
  }

  try {
    const result = await fetchStockPrice(code);

    if (!result) {
      return NextResponse.json({ error: '시세 조회에 실패했습니다.' }, { status: 404 });
    }

    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch (error) {
    console.error('Failed to fetch stock price:', error);
    return NextResponse.json({ error: '시세 조회에 실패했습니다.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { codes } = await request.json();

    if (!Array.isArray(codes) || codes.length === 0) {
      return NextResponse.json({ error: '종목코드 배열이 필요합니다.' }, { status: 400 });
    }

    const results: Record<string, StockPriceResult | null> = {};

    await Promise.all(
      codes.map(async (code: string) => {
        results[code] = await fetchStockPrice(code);
      })
    );

    return NextResponse.json({ prices: results }, { headers: CACHE_HEADERS });
  } catch (error) {
    console.error('Failed to fetch stock prices:', error);
    return NextResponse.json({ error: '시세 조회에 실패했습니다.' }, { status: 500 });
  }
}

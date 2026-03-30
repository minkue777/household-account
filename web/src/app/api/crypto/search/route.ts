import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface UpbitMarket {
  market: string;
  korean_name: string;
  english_name: string;
}

interface CryptoSearchResult {
  code: string;
  name: string;
}

const CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

let cachedMarkets: UpbitMarket[] | null = null;
let cachedAt = 0;
const MARKET_CACHE_MS = 1000 * 60 * 10;

async function fetchUpbitMarkets(): Promise<UpbitMarket[]> {
  const now = Date.now();
  if (cachedMarkets && now - cachedAt < MARKET_CACHE_MS) {
    return cachedMarkets;
  }

  const response = await fetch('https://api.upbit.com/v1/market/all?isDetails=false', {
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('업비트 마켓 목록 조회 실패');
  }

  const markets: UpbitMarket[] = await response.json();
  cachedMarkets = markets.filter((market) => market.market.startsWith('KRW-'));
  cachedAt = now;
  return cachedMarkets;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');

  if (!query || query.length < 1) {
    return NextResponse.json({ results: [] }, { headers: CACHE_HEADERS });
  }

  try {
    const lowerQuery = query.toLowerCase();
    const markets = await fetchUpbitMarkets();

    const results: CryptoSearchResult[] = markets
      .filter((market) => {
        const english = market.english_name?.toLowerCase() || '';
        return (
          market.korean_name.includes(query) ||
          english.includes(lowerQuery) ||
          market.market.toLowerCase().includes(lowerQuery)
        );
      })
      .slice(0, 10)
      .map((market) => ({
        code: market.market,
        name: market.korean_name,
      }));

    return NextResponse.json({ results }, { headers: CACHE_HEADERS });
  } catch (error) {
    console.error('코인 검색 오류:', error);
    return NextResponse.json({ results: [] }, { headers: CACHE_HEADERS });
  }
}

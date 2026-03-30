import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface UpbitTickerResponse {
  market: string;
  trade_price: number;
  signed_change_price: number;
  signed_change_rate: number;
  prev_closing_price: number;
}

const CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

async function fetchUpbitTicker(market: string) {
  const response = await fetch(
    `https://api.upbit.com/v1/ticker?markets=${encodeURIComponent(market)}`,
    {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const data: UpbitTickerResponse[] = await response.json();
  const ticker = data[0];

  if (!ticker) {
    return null;
  }

  return {
    code: ticker.market,
    name: ticker.market,
    price: Math.round(ticker.trade_price),
    change: Math.round(ticker.signed_change_price),
    changePercent: ticker.signed_change_rate * 100,
    previousClose: Math.round(ticker.prev_closing_price),
    currency: 'KRW',
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const market = searchParams.get('market');

  if (!market) {
    return NextResponse.json({ error: '마켓 코드가 필요합니다' }, { status: 400 });
  }

  try {
    const result = await fetchUpbitTicker(market);

    if (!result) {
      return NextResponse.json({ error: '시세 조회 실패' }, { status: 404 });
    }

    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch (error) {
    console.error('코인 시세 조회 오류:', error);
    return NextResponse.json({ error: '시세 조회 실패' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

// Vercel 캐싱 비활성화
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
}

interface NaverStockResponse {
  stockName: string;
  closePrice: string;
  compareToPreviousClosePrice: string;
  fluctuationsRatio: string;
}

const CACHE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
};

/**
 * 네이버 금융 API로 주식 시세 조회
 */
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

    // 콤마 제거하고 숫자로 변환
    const price = parseInt(data.closePrice.replace(/,/g, ''), 10);
    const change = parseInt(data.compareToPreviousClosePrice.replace(/,/g, ''), 10);
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
    console.error(`네이버 시세 조회 오류 (${code}):`, error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json({ error: '종목코드가 필요합니다' }, { status: 400 });
  }

  try {
    const result = await fetchNaverStock(code);

    if (!result) {
      return NextResponse.json({ error: '시세 조회 실패' }, { status: 404 });
    }

    return NextResponse.json(result, { headers: CACHE_HEADERS });
  } catch (error) {
    console.error('시세 조회 오류:', error);
    return NextResponse.json({ error: '시세 조회 실패' }, { status: 500 });
  }
}

// 여러 종목 한번에 조회
export async function POST(request: NextRequest) {
  try {
    const { codes } = await request.json();

    if (!codes || !Array.isArray(codes) || codes.length === 0) {
      return NextResponse.json({ error: '종목코드 배열이 필요합니다' }, { status: 400 });
    }

    const results: Record<string, StockPriceResult | null> = {};

    // 병렬로 조회
    await Promise.all(
      codes.map(async (code: string) => {
        results[code] = await fetchNaverStock(code);
      })
    );

    return NextResponse.json({ prices: results }, { headers: CACHE_HEADERS });
  } catch (error) {
    console.error('시세 일괄 조회 오류:', error);
    return NextResponse.json({ error: '시세 조회 실패' }, { status: 500 });
  }
}

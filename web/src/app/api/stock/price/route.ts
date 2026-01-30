import { NextRequest, NextResponse } from 'next/server';

interface StockPriceResult {
  code: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  previousClose: number;
  currency: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json({ error: '종목코드가 필요합니다' }, { status: 400 });
  }

  try {
    // Yahoo Finance API로 시세 조회
    // 한국 주식은 .KS (코스피) 또는 .KQ (코스닥) 접미사 필요
    const symbol = code.includes('.') ? code : `${code}.KS`;
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;

    const response = await fetch(yahooUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      // 코스피에서 못 찾으면 코스닥으로 재시도
      if (!code.includes('.')) {
        const kosdaq = `${code}.KQ`;
        const retryResponse = await fetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${kosdaq}?interval=1d&range=1d`,
          {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          }
        );

        if (retryResponse.ok) {
          const retryData = await retryResponse.json();
          return parseYahooResponse(retryData, code);
        }
      }
      throw new Error('시세 조회 실패');
    }

    const data = await response.json();
    return parseYahooResponse(data, code);
  } catch (error) {
    console.error('시세 조회 오류:', error);
    return NextResponse.json({ error: '시세 조회 실패' }, { status: 500 });
  }
}

function parseYahooResponse(data: any, code: string): NextResponse {
  const result = data.chart?.result?.[0];
  if (!result) {
    return NextResponse.json({ error: '데이터 없음' }, { status: 404 });
  }

  const meta = result.meta;
  const price = meta.regularMarketPrice;
  const previousClose = meta.previousClose || meta.chartPreviousClose;
  const change = price - previousClose;
  const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

  const priceResult: StockPriceResult = {
    code,
    name: meta.shortName || meta.longName || meta.symbol,
    price: Math.round(price),
    change: Math.round(change),
    changePercent: Math.round(changePercent * 100) / 100,
    previousClose: Math.round(previousClose),
    currency: meta.currency || 'KRW',
  };

  return NextResponse.json(priceResult);
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
        try {
          const symbol = code.includes('.') ? code : `${code}.KS`;
          const response = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`,
            {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              },
            }
          );

          if (response.ok) {
            const data = await response.json();
            const result = data.chart?.result?.[0];
            if (result) {
              const meta = result.meta;
              const price = meta.regularMarketPrice;
              const previousClose = meta.previousClose || meta.chartPreviousClose;
              const change = price - previousClose;
              const changePercent = previousClose > 0 ? (change / previousClose) * 100 : 0;

              results[code] = {
                code,
                name: meta.shortName || meta.longName || meta.symbol,
                price: Math.round(price),
                change: Math.round(change),
                changePercent: Math.round(changePercent * 100) / 100,
                previousClose: Math.round(previousClose),
                currency: meta.currency || 'KRW',
              };
              return;
            }
          }
          results[code] = null;
        } catch {
          results[code] = null;
        }
      })
    );

    return NextResponse.json({ prices: results });
  } catch (error) {
    console.error('시세 일괄 조회 오류:', error);
    return NextResponse.json({ error: '시세 조회 실패' }, { status: 500 });
  }
}

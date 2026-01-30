import { NextRequest, NextResponse } from 'next/server';

interface StockSearchResult {
  code: string;
  name: string;
  market: string;
  type: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] });
  }

  try {
    // 네이버 금융 자동완성 API
    const encodedQuery = encodeURIComponent(query);
    const naverUrl = `https://ac.finance.naver.com/ac?q=${encodedQuery}&q_enc=utf-8&t_korstock=1&t_usstock=0&st=111&r_lt=111`;

    const response = await fetch(naverUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!response.ok) {
      throw new Error('네이버 API 호출 실패');
    }

    const data = await response.json();
    const results: StockSearchResult[] = [];

    // 네이버 자동완성 응답 파싱
    // 형식: { items: [[ [종목명, 종목코드, 시장, ...], ... ]] }
    if (data.items && data.items[0]) {
      for (const item of data.items[0]) {
        if (item.length >= 2) {
          const name = item[0];
          const code = item[1];
          // 시장 구분 (코스피/코스닥)
          const market = code.length === 6 ? 'KRX' : 'OTHER';

          results.push({
            code,
            name,
            market,
            type: name.includes('ETF') || name.includes('TIGER') || name.includes('KODEX') || name.includes('ARIRANG') ? 'ETF' : 'STOCK',
          });
        }
      }
    }

    return NextResponse.json({ results: results.slice(0, 10) });
  } catch (error) {
    console.error('종목 검색 오류:', error);

    // 폴백: Yahoo Finance 검색
    try {
      const yahooUrl = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&lang=ko-KR&region=KR`;
      const yahooResponse = await fetch(yahooUrl);
      const yahooData = await yahooResponse.json();

      const results: StockSearchResult[] = [];
      if (yahooData.quotes) {
        for (const quote of yahooData.quotes) {
          // 한국 주식만 필터링
          if (quote.symbol?.endsWith('.KS') || quote.symbol?.endsWith('.KQ')) {
            results.push({
              code: quote.symbol.replace('.KS', '').replace('.KQ', ''),
              name: quote.shortname || quote.longname || quote.symbol,
              market: quote.symbol.endsWith('.KS') ? 'KOSPI' : 'KOSDAQ',
              type: quote.quoteType === 'ETF' ? 'ETF' : 'STOCK',
            });
          }
        }
      }

      return NextResponse.json({ results });
    } catch {
      return NextResponse.json({ results: [], error: '검색 실패' });
    }
  }
}

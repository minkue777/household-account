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

  // 여러 소스에서 순차적으로 시도
  let results: StockSearchResult[] = [];

  // 1. KRX API 시도
  try {
    results = await searchKRX(query);
    if (results.length > 0) {
      return NextResponse.json({ results: results.slice(0, 15) });
    }
  } catch (error) {
    console.error('KRX 검색 실패:', error);
  }

  // 2. 네이버 금융 시도
  try {
    results = await searchNaver(query);
    if (results.length > 0) {
      return NextResponse.json({ results: results.slice(0, 15) });
    }
  } catch (error) {
    console.error('네이버 검색 실패:', error);
  }

  // 3. Yahoo Finance 폴백
  try {
    results = await searchYahoo(query);
    return NextResponse.json({ results: results.slice(0, 15) });
  } catch (error) {
    console.error('Yahoo 검색 실패:', error);
    return NextResponse.json({ results: [], error: '검색 실패' });
  }
}

// KRX 종목 검색
async function searchKRX(query: string): Promise<StockSearchResult[]> {
  const url = 'http://data.krx.co.kr/comm/bldAttendant/getJsonData.cmd';

  const formData = new URLSearchParams();
  formData.append('bld', 'dbms/comm/finder/finder_stkisu');
  formData.append('mktsel', 'ALL');
  formData.append('searchText', query);
  formData.append('typeNo', '0');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'http://data.krx.co.kr/contents/MDC/MDI/mdiLoader/index.cmd',
    },
    body: formData.toString(),
  });

  if (!response.ok) {
    throw new Error(`KRX API 응답 오류: ${response.status}`);
  }

  const data = await response.json();
  const results: StockSearchResult[] = [];

  if (data.block1) {
    for (const item of data.block1) {
      results.push({
        code: item.short_code || item.shrt_cd,
        name: item.codeName || item.isin_name,
        market: item.marketName || item.mkt_nm || 'KRX',
        type: detectType(item.codeName || item.isin_name),
      });
    }
  }

  return results;
}

// 네이버 금융 자동완성 검색
async function searchNaver(query: string): Promise<StockSearchResult[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `https://ac.finance.naver.com/ac?q=${encodedQuery}&q_enc=utf-8&t_korstock=1&t_usstock=0&st=111&r_lt=111`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      'Referer': 'https://finance.naver.com/',
    },
  });

  if (!response.ok) {
    throw new Error(`네이버 API 응답 오류: ${response.status}`);
  }

  const data = await response.json();
  const results: StockSearchResult[] = [];

  if (data.items && data.items[0]) {
    for (const item of data.items[0]) {
      if (item.length >= 2) {
        const name = item[0];
        const code = item[1];
        results.push({
          code,
          name,
          market: 'KRX',
          type: detectType(name),
        });
      }
    }
  }

  return results;
}

// Yahoo Finance 검색
async function searchYahoo(query: string): Promise<StockSearchResult[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=20&lang=ko-KR&region=KR`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(`Yahoo API 응답 오류: ${response.status}`);
  }

  const data = await response.json();
  const results: StockSearchResult[] = [];

  if (data.quotes) {
    for (const quote of data.quotes) {
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

  return results;
}

// 종목 유형 감지
function detectType(name: string): string {
  const upperName = name.toUpperCase();
  if (upperName.includes('ETF') ||
      upperName.includes('TIGER') ||
      upperName.includes('KODEX') ||
      upperName.includes('ARIRANG') ||
      upperName.includes('KBSTAR') ||
      upperName.includes('SOL') ||
      upperName.includes('ACE') ||
      upperName.includes('HANARO')) {
    return 'ETF';
  }
  return 'STOCK';
}

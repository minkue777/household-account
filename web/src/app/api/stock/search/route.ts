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
    const results = await searchKRX(query);
    return NextResponse.json({ results: results.slice(0, 15) });
  } catch (error) {
    console.error('KRX 검색 실패:', error);
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

import { NextRequest, NextResponse } from 'next/server';

interface DividendInfo {
  code: string;
  name: string;
  recentDividend: number | null;      // 최근 분배금 (원)
  paymentDate: string | null;          // 지급일
  frequency: number | null;            // 연간 지급 횟수
  dividendYield: number | null;        // 배당수익률 (%)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');

  if (!code) {
    return NextResponse.json(
      { error: '종목 코드가 필요합니다' },
      { status: 400 }
    );
  }

  try {
    // FnGuide ETF 페이지에서 분배금 정보 크롤링
    const url = `https://comp.fnguide.com/SVO2/ASP/etf_snapshot.asp?pGB=1&gicode=A${code}`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });

    if (!response.ok) {
      throw new Error('FnGuide 페이지 조회 실패');
    }

    const html = await response.text();

    // HTML 파싱하여 분배금 정보 추출
    const dividendInfo = parseDividendInfo(html, code);

    return NextResponse.json(dividendInfo);
  } catch (error) {
    console.error('배당금 조회 오류:', error);
    return NextResponse.json(
      { error: '배당금 정보를 가져올 수 없습니다' },
      { status: 500 }
    );
  }
}

function parseDividendInfo(html: string, code: string): DividendInfo {
  const result: DividendInfo = {
    code,
    name: '',
    recentDividend: null,
    paymentDate: null,
    frequency: null,
    dividendYield: null,
  };

  try {
    // 종목명 추출
    const nameMatch = html.match(/<title>([^<]+)/);
    if (nameMatch) {
      result.name = nameMatch[1].replace(/\s*\|.*$/, '').trim();
    }

    // 최근 분배금 추출 - "최근 분배금(원)" 또는 비슷한 패턴
    const dividendMatch = html.match(/최근\s*분배금[^0-9]*([0-9,]+)/);
    if (dividendMatch) {
      result.recentDividend = parseInt(dividendMatch[1].replace(/,/g, ''), 10);
    }

    // 지급일 추출 - YYYY/MM/DD 형식
    const dateMatch = html.match(/(\d{4}\/\d{2}\/\d{2})/);
    if (dateMatch) {
      result.paymentDate = dateMatch[1];
    }

    // 연간 지급 횟수 추출
    const frequencyMatch = html.match(/연\s*(\d+)\s*회/);
    if (frequencyMatch) {
      result.frequency = parseInt(frequencyMatch[1], 10);
    }

    // 배당수익률 추출
    const yieldMatch = html.match(/배당수익률[^0-9]*([0-9.]+)\s*%/);
    if (yieldMatch) {
      result.dividendYield = parseFloat(yieldMatch[1]);
    }
  } catch (e) {
    console.error('HTML 파싱 오류:', e);
  }

  return result;
}

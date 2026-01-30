import { NextResponse } from 'next/server';

// 1돈 = 3.75g
const DON_TO_GRAM = 3.75;

export async function GET() {
  try {
    // 한국 금 시세 조회 (네이버 금융에서 국제 금 시세 + 환율로 계산)
    // 또는 직접 금 시세 API 사용

    // 방법 1: Yahoo Finance에서 국제 금 시세 조회 (USD/oz)
    const goldResponse = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1d',
      { next: { revalidate: 300 } } // 5분 캐시
    );

    if (!goldResponse.ok) {
      throw new Error('금 시세 조회 실패');
    }

    const goldData = await goldResponse.json();
    const goldUsdPerOz = goldData.chart?.result?.[0]?.meta?.regularMarketPrice;

    if (!goldUsdPerOz) {
      throw new Error('금 시세 데이터 없음');
    }

    // 환율 조회 (USD/KRW)
    const fxResponse = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1d&range=1d',
      { next: { revalidate: 300 } }
    );

    let usdKrw = 1350; // 기본값
    if (fxResponse.ok) {
      const fxData = await fxResponse.json();
      usdKrw = fxData.chart?.result?.[0]?.meta?.regularMarketPrice || 1350;
    }

    // 1 troy oz = 31.1035g
    const TROY_OZ_TO_GRAM = 31.1035;

    // g당 원화 가격 계산
    const pricePerGram = (goldUsdPerOz / TROY_OZ_TO_GRAM) * usdKrw;

    // 1돈 가격 계산
    const pricePerDon = pricePerGram * DON_TO_GRAM;

    return NextResponse.json({
      pricePerGram: Math.round(pricePerGram),
      pricePerDon: Math.round(pricePerDon),
      goldUsdPerOz: Math.round(goldUsdPerOz * 100) / 100,
      usdKrw: Math.round(usdKrw),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('금 시세 조회 오류:', error);

    // 실패 시 대략적인 시세 반환 (2024년 기준 약 10만원/돈)
    return NextResponse.json({
      pricePerGram: 95000,
      pricePerDon: 356250,
      goldUsdPerOz: 2300,
      usdKrw: 1350,
      timestamp: new Date().toISOString(),
      estimated: true,
    });
  }
}

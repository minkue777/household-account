import { NextResponse } from 'next/server';

// 1돈 = 3.75g
const DON_TO_GRAM = 3.75;
// 금 거래 스프레드 (약 2.5%)
const SPREAD_PERCENT = 0.025;

export async function GET() {
  try {
    // Yahoo Finance에서 국제 금 시세 조회 (USD/oz)
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

    // g당 원화 가격 계산 (기준가)
    const basePricePerGram = (goldUsdPerOz / TROY_OZ_TO_GRAM) * usdKrw;

    // 1돈 가격 계산
    const basePricePerDon = basePricePerGram * DON_TO_GRAM;

    // 살 때 (buy): 기준가 + 스프레드
    const buyPricePerDon = Math.round(basePricePerDon * (1 + SPREAD_PERCENT));
    // 팔 때 (sell): 기준가 - 스프레드
    const sellPricePerDon = Math.round(basePricePerDon * (1 - SPREAD_PERCENT));

    return NextResponse.json({
      buyPricePerDon,   // 살 때 (1돈)
      sellPricePerDon,  // 팔 때 (1돈)
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('금 시세 조회 오류:', error);

    // 실패 시 대략적인 시세 반환
    return NextResponse.json({
      buyPricePerDon: 365000,
      sellPricePerDon: 347000,
      timestamp: new Date().toISOString(),
      estimated: true,
    });
  }
}

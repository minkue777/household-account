import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// 1돈 = 3.75g
const DON_TO_GRAM = 3.75;
// 금 거래 스프레드 (약 2.5%)
const SPREAD_PERCENT = 0.025;

export async function GET() {
  try {
    const goldResponse = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=1d',
      { next: { revalidate: 300 } }
    );

    if (!goldResponse.ok) {
      throw new Error('금 시세 조회 실패');
    }

    const goldData = await goldResponse.json();
    const goldUsdPerOz = goldData.chart?.result?.[0]?.meta?.regularMarketPrice;

    if (!goldUsdPerOz) {
      throw new Error('금 시세 데이터 없음');
    }

    const fxResponse = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/KRW=X?interval=1d&range=1d',
      { next: { revalidate: 300 } }
    );

    let usdKrw = 1350;
    if (fxResponse.ok) {
      const fxData = await fxResponse.json();
      usdKrw = fxData.chart?.result?.[0]?.meta?.regularMarketPrice || 1350;
    }

    const troyOzToGram = 31.1035;
    const basePricePerGram = (goldUsdPerOz / troyOzToGram) * usdKrw;
    const basePricePerDon = basePricePerGram * DON_TO_GRAM;

    const buyPricePerDon = Math.round(basePricePerDon * (1 + SPREAD_PERCENT));
    const sellPricePerDon = Math.round(basePricePerDon * (1 - SPREAD_PERCENT));

    return NextResponse.json({
      buyPricePerDon,
      sellPricePerDon,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('금 시세 조회 오류:', error);

    return NextResponse.json({
      buyPricePerDon: 365000,
      sellPricePerDon: 347000,
      timestamp: new Date().toISOString(),
      estimated: true,
    });
  }
}

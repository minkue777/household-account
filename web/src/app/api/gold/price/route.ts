import { NextResponse } from 'next/server';
import { fetchNaverGoldMarketData } from '@/lib/server/naverGoldPrice';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DON_TO_GRAM = 3.75;
const SPREAD_PERCENT = 0.025;

export async function GET() {
  try {
    const marketData = await fetchNaverGoldMarketData();

    if (!marketData) {
      throw new Error('네이버 금 시세 조회 실패');
    }

    const basePricePerDon = marketData.pricePerGram * DON_TO_GRAM;
    const buyPricePerDon = Math.round(basePricePerDon * (1 + SPREAD_PERCENT));
    const sellPricePerDon = Math.round(basePricePerDon * (1 - SPREAD_PERCENT));

    return NextResponse.json({
      buyPricePerDon,
      sellPricePerDon,
      timestamp: marketData.timestamp,
      source: 'NAVER_KRX_GOLD',
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

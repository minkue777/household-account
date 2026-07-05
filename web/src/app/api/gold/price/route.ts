import { NextResponse } from 'next/server';
import { fetchNaverGoldMarketData } from '@/lib/server/naverGoldPrice';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const DON_TO_GRAM = 3.75;

export async function GET() {
  try {
    const marketData = await fetchNaverGoldMarketData();

    if (!marketData) {
      throw new Error('금 시세 데이터 없음');
    }

    const pricePerDon = Math.round(marketData.pricePerGram * DON_TO_GRAM);
    const previousClosePerDon = Math.round(marketData.previousClosePerGram * DON_TO_GRAM);

    return NextResponse.json({
      pricePerDon,
      buyPricePerDon: pricePerDon,
      sellPricePerDon: pricePerDon,
      previousClosePerDon,
      pricePerGram: marketData.pricePerGram,
      previousClosePerGram: marketData.previousClosePerGram,
      timestamp: marketData.timestamp,
      source: 'naver-krx-gold-market',
    });
  } catch (error) {
    console.error('금 시세 조회 오류:', error);

    return NextResponse.json({
      pricePerDon: 356000,
      buyPricePerDon: 356000,
      sellPricePerDon: 356000,
      timestamp: new Date().toISOString(),
      estimated: true,
    });
  }
}

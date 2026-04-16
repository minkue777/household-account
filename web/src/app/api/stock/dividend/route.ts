import { NextRequest, NextResponse } from 'next/server';
import { fetchKindEtfDividendInfo } from '@/lib/server/kindEtfDividend';
import { fetchKindStockDividendInfo } from '@/lib/server/kindStockDividend';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface NaverInfoItem {
  code?: string;
  key?: string;
  value?: string;
  valueDesc?: string;
}

interface NaverIntegrationResponse {
  stockEndType?: string;
  stockName?: string;
  totalInfos?: NaverInfoItem[];
  etfKeyIndicator?: {
    dividendYieldTtm?: number | null;
  } | null;
}

interface DividendInfo {
  code: string;
  name: string;
  recentDividend: number | null;
  paymentDate: string | null;
  frequency: number | null;
  dividendYield: number | null;
  annualDividendPerShare: number | null;
  isEstimated: boolean;
  paymentEvents: Array<{
    paymentDate: string;
    dividend: number;
  }>;
}

function parseNumberText(value?: string | number | null) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (!value) {
    return null;
  }

  const normalized = value.replace(/[^0-9.-]/g, '');
  if (!normalized) {
    return null;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePercentText(value?: string | number | null) {
  return parseNumberText(value);
}

function buildInfoMap(items?: NaverInfoItem[]) {
  const infoMap = new Map<string, NaverInfoItem>();

  (items || []).forEach((item) => {
    if (!item.code) {
      return;
    }

    infoMap.set(item.code, item);
  });

  return infoMap;
}

function isDomesticNumericCode(code: string) {
  return /^\d+$/.test(code);
}

function isDomesticAlphaNumericCode(code: string) {
  return /^[A-Z0-9]+$/.test(code) && !isDomesticNumericCode(code);
}

async function parseDividendInfo(
  code: string,
  payload: NaverIntegrationResponse
): Promise<DividendInfo> {
  const infoMap = buildInfoMap(payload.totalInfos);
  const stockName = payload.stockName || code;
  const stockEndType = payload.stockEndType || 'stock';

  const closePrice = parseNumberText(infoMap.get('lastClosePrice')?.value);
  const stockAnnualDividend = parseNumberText(infoMap.get('dividend')?.value);
  const stockDividendYield = parsePercentText(infoMap.get('dividendYieldRatio')?.value);
  const etfDividendYield = parsePercentText(payload.etfKeyIndicator?.dividendYieldTtm);

  if (stockEndType === 'stock') {
    try {
      const kindDividendInfo = await fetchKindStockDividendInfo(code, stockName);

      if (kindDividendInfo) {
        return {
          code,
          name: stockName,
          recentDividend: kindDividendInfo.recentDividend,
          paymentDate: kindDividendInfo.paymentDate,
          frequency: kindDividendInfo.frequency,
          dividendYield: kindDividendInfo.dividendYield ?? stockDividendYield,
          annualDividendPerShare: kindDividendInfo.annualDividendPerShare,
          isEstimated: false,
          paymentEvents: kindDividendInfo.paymentEvents,
        };
      }
    } catch (error) {
      console.error('KIND 개별주식 배당 조회 오류:', error);
    }

    return {
      code,
      name: stockName,
      recentDividend: null,
      paymentDate: null,
      frequency: null,
      dividendYield: stockDividendYield,
      annualDividendPerShare: stockAnnualDividend,
      isEstimated: false,
      paymentEvents: [],
    };
  }

  try {
    const kindDividendInfo = await fetchKindEtfDividendInfo(code, stockName);

    if (kindDividendInfo) {
      return {
        code,
        name: stockName,
        recentDividend: kindDividendInfo.recentDividend,
        paymentDate: kindDividendInfo.paymentDate,
        frequency: kindDividendInfo.frequency,
        dividendYield: etfDividendYield,
        annualDividendPerShare: kindDividendInfo.annualDividendPerShare,
        isEstimated: false,
        paymentEvents: kindDividendInfo.paymentEvents,
      };
    }
  } catch (error) {
    console.error('KIND ETF 배당 조회 오류:', error);
  }

  const annualDividendPerShare =
    closePrice && etfDividendYield ? Math.round((closePrice * etfDividendYield) / 100) : null;

  return {
    code,
    name: stockName,
    recentDividend: null,
    paymentDate: null,
    frequency: null,
    dividendYield: etfDividendYield,
    annualDividendPerShare,
    isEstimated: annualDividendPerShare !== null,
    paymentEvents: [],
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code')?.trim().toUpperCase();
  const stockName = searchParams.get('name')?.trim() ?? '';

  if (!code) {
    return NextResponse.json({ error: '종목 코드가 필요합니다.' }, { status: 400 });
  }

  if (isDomesticAlphaNumericCode(code)) {
    try {
      const resolvedName = stockName || code;
      const kindDividendInfo = await fetchKindEtfDividendInfo(code, resolvedName);

      if (!kindDividendInfo) {
        return NextResponse.json({
          code,
          name: resolvedName,
          recentDividend: null,
          paymentDate: null,
          frequency: null,
          dividendYield: null,
          annualDividendPerShare: null,
          isEstimated: false,
          paymentEvents: [],
        } satisfies DividendInfo);
      }

      return NextResponse.json({
        code,
        name: resolvedName,
        recentDividend: kindDividendInfo.recentDividend,
        paymentDate: kindDividendInfo.paymentDate,
        frequency: kindDividendInfo.frequency,
        dividendYield: null,
        annualDividendPerShare: kindDividendInfo.annualDividendPerShare,
        isEstimated: false,
        paymentEvents: kindDividendInfo.paymentEvents,
      } satisfies DividendInfo);
    } catch (error) {
      console.error('KIND ETF 배당 조회 오류:', error);
      return NextResponse.json(
        { error: '배당금 정보를 가져올 수 없습니다.' },
        { status: 500 }
      );
    }
  }

  if (!isDomesticNumericCode(code)) {
    return NextResponse.json({ error: '지원하지 않는 종목 코드입니다.' }, { status: 400 });
  }

  try {
    const response = await fetch(`https://m.stock.naver.com/api/stock/${code}/integration`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        Referer: 'https://m.stock.naver.com/',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`네이버 종목 정보 조회 실패 (${response.status})`);
    }

    const payload = (await response.json()) as NaverIntegrationResponse;
    return NextResponse.json(await parseDividendInfo(code, payload));
  } catch (error) {
    console.error('배당금 조회 오류:', error);
    return NextResponse.json(
      { error: '배당금 정보를 가져올 수 없습니다.' },
      { status: 500 }
    );
  }
}

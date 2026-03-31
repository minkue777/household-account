import { NextRequest, NextResponse } from 'next/server';
import stocksData from '@/data/stocks.json';
import { getUsStockAliases } from '@/lib/server/usStockAliases';
import { getUsStockSymbols } from '@/lib/server/usStockSymbols';

interface StockSearchResult {
  code: string;
  name: string;
  market?: 'KR' | 'US';
}

interface SearchCandidate extends StockSearchResult {
  score: number;
}

const STOCK_SEARCH_ALIASES: Record<string, string[]> = {
  KRXGOLD1KG: ['krx금현물', 'krx 금현물', '금현물', '금99.99', '금 99.99', '1kg금'],
  KRXGOLD100G: ['krx금현물', 'krx 금현물', '금현물', '미니금', '100g금', '100g 금'],
};

function normalizeSearchValue(value: string) {
  return value.toLowerCase().replace(/[\s\-_.():/]/g, '');
}

function getSearchScore({
  query,
  normalizedQuery,
  name,
  code,
  aliases = [],
}: {
  query: string;
  normalizedQuery: string;
  name: string;
  code: string;
  aliases?: string[];
}) {
  const lowerName = name.toLowerCase();
  const lowerCode = code.toLowerCase();
  const normalizedName = normalizeSearchValue(name);
  const normalizedCode = normalizeSearchValue(code);
  const normalizedAliases = aliases.map(normalizeSearchValue);

  if (normalizedCode === normalizedQuery) return 600;
  if (normalizedCode.startsWith(normalizedQuery)) return 520;
  if (lowerCode.includes(query)) return 470;

  if (normalizedName === normalizedQuery) return 430;
  if (normalizedName.startsWith(normalizedQuery)) return 390;
  if (lowerName.includes(query)) return 350;
  if (normalizedName.includes(normalizedQuery)) return 320;

  if (normalizedAliases.some((alias) => alias === normalizedQuery)) return 300;
  if (normalizedAliases.some((alias) => alias.includes(normalizedQuery))) return 260;

  return -1;
}

async function getDomesticResults(query: string, normalizedQuery: string): Promise<SearchCandidate[]> {
  const results = stocksData.stocks
    .map((stock) => {
      const aliases = STOCK_SEARCH_ALIASES[stock.code] || [];
      const score = getSearchScore({
        query,
        normalizedQuery,
        name: stock.name,
        code: stock.code,
        aliases,
      });

      if (score < 0) {
        return null;
      }

      return {
        code: stock.code,
        name: stock.name,
        market: 'KR',
        score,
      } as SearchCandidate;
    })
    .filter(Boolean) as SearchCandidate[];

  return results;
}

async function getUsResults(query: string, normalizedQuery: string): Promise<SearchCandidate[]> {
  try {
    // 미국 종목은 정적 JSON 대신 실시간 심볼 목록을 읽어 검색합니다.
    const usSymbols = await getUsStockSymbols();

    const results = usSymbols
      .map((symbol) => {
        const aliases = getUsStockAliases(symbol.symbol);
        const score = getSearchScore({
          query,
          normalizedQuery,
          name: symbol.name,
          code: symbol.symbol,
          aliases,
        });

        if (score < 0) {
          return null;
        }

        return {
          code: `US:${symbol.symbol}`,
          name: symbol.name,
          market: 'US',
          score,
        } as SearchCandidate;
      })
      .filter(Boolean) as SearchCandidate[];

    return results;
  } catch (error) {
    console.error('Failed to search US symbols:', error);
    return [];
  }
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get('q')?.trim();

  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const lowerQuery = query.toLowerCase();
  const normalizedQuery = normalizeSearchValue(query);

  const [domesticResults, usResults] = await Promise.all([
    getDomesticResults(lowerQuery, normalizedQuery),
    getUsResults(lowerQuery, normalizedQuery),
  ]);

  const results = [...domesticResults, ...usResults]
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }

      if ((a.market || 'KR') !== (b.market || 'KR')) {
        return (a.market || 'KR').localeCompare(b.market || 'KR');
      }

      return a.name.localeCompare(b.name);
    })
    .slice(0, 10)
    .map(({ score: _score, ...result }) => result);

  return NextResponse.json({ results });
}

import { NextRequest, NextResponse } from 'next/server';
import stocksData from '@/data/stocks.json';

interface StockSearchResult {
  code: string;
  name: string;
}

const STOCK_SEARCH_ALIASES: Record<string, string[]> = {
  KRXGOLD1KG: ['krx금현물', 'krx 금현물', '금현물', '금99.99', '금 99.99', '1kg금'],
  KRXGOLD100G: ['krx금현물', 'krx 금현물', '금현물', '미니금', '100g금', '100g 금'],
};

function normalizeSearchValue(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s\-_.()/]/g, '');
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');

  if (!query || query.length < 1) {
    return NextResponse.json({ results: [] });
  }

  const lowerQuery = query.toLowerCase();
  const normalizedQuery = normalizeSearchValue(query);

  const results: StockSearchResult[] = stocksData.stocks
    .filter((stock) => {
      const lowerName = stock.name.toLowerCase();
      const normalizedName = normalizeSearchValue(stock.name);
      const normalizedCode = normalizeSearchValue(stock.code);
      const aliases = STOCK_SEARCH_ALIASES[stock.code] || [];
      const matchesAlias = aliases.some((alias) =>
        normalizeSearchValue(alias).includes(normalizedQuery)
      );

      return (
        lowerName.includes(lowerQuery) ||
        stock.code.includes(query) ||
        normalizedName.includes(normalizedQuery) ||
        normalizedCode.includes(normalizedQuery) ||
        matchesAlias
      );
    })
    .slice(0, 10);

  return NextResponse.json({ results });
}

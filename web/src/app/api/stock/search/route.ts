import { NextRequest, NextResponse } from 'next/server';
import stocksData from '@/data/stocks.json';

interface StockSearchResult {
  code: string;
  name: string;
}

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

      return (
        lowerName.includes(lowerQuery) ||
        stock.code.includes(query) ||
        normalizedName.includes(normalizedQuery) ||
        normalizedCode.includes(normalizedQuery)
      );
    })
    .slice(0, 10);

  return NextResponse.json({ results });
}

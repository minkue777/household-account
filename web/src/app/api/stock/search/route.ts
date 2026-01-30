import { NextRequest, NextResponse } from 'next/server';
import stocksData from '@/data/stocks.json';

interface StockSearchResult {
  code: string;
  name: string;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');

  if (!query || query.length < 1) {
    return NextResponse.json({ results: [] });
  }

  const lowerQuery = query.toLowerCase();

  const results: StockSearchResult[] = stocksData.stocks
    .filter(stock =>
      stock.name.toLowerCase().includes(lowerQuery) ||
      stock.code.includes(query)
    )
    .slice(0, 10);

  return NextResponse.json({ results });
}

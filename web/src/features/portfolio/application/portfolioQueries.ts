import { getHouseholdQueryClient } from '@/composition/webQueryRuntime';
import { getStockInstrumentCatalog } from '@/composition/stockInstrumentCatalogRuntime';
import type {
  PortfolioDividendProjectionQueryResult,
  PortfolioQuoteQueryResult,
} from '@/platform/functions-api';
import type {
  CryptoPriceInfo,
  CryptoSearchResult,
  StockPriceInfo,
  StockSearchResult,
} from '@/types/asset';

function stockPriceInfo(result: PortfolioQuoteQueryResult): StockPriceInfo {
  const instrumentType =
    result.instrument.instrumentType === 'etn'
      ? 'etn'
      : result.instrument.instrumentType === 'fund'
        ? 'fund'
        : result.instrument.instrumentType === 'etf'
          ? 'etf'
          : 'stock';
  return {
    code: result.instrument.code,
    name: result.instrument.name,
    price: result.priceInWon,
    change: 0,
    changePercent: 0,
    previousClose: result.priceInWon,
    currency: 'KRW',
    instrumentType,
    priceScale: result.instrument.priceScale,
    quoteAsOf: result.quoteAsOf,
  };
}

export const portfolioQueries = {
  async searchStocks(query: string): Promise<StockSearchResult[]> {
    return getStockInstrumentCatalog().search(query, 10);
  },

  async searchCrypto(query: string): Promise<CryptoSearchResult[]> {
    const result = await getHouseholdQueryClient().execute(
      'portfolio.search-instruments.v1',
      { assetClass: 'crypto', query, limit: 10 }
    );
    return result.items
      .filter(
        (instrument) =>
          instrument.market === 'UPBIT_KRW' && instrument.instrumentType === 'crypto'
      )
      .map((instrument) => ({ code: instrument.code, name: instrument.name }));
  },

  async getStockQuote(stock: StockSearchResult): Promise<StockPriceInfo> {
    const result = await getHouseholdQueryClient().execute(
      'portfolio.get-instrument-quote.v1',
      {
        market: stock.market,
        code: stock.code,
        name: stock.name,
        instrumentType: stock.instrumentType ?? 'stock',
        priceScale: stock.priceScale ?? (stock.market === 'KOFIA_FUND' ? 1_000 : 1),
      }
    );
    return stockPriceInfo(result);
  },

  async getCryptoQuote(coin: CryptoSearchResult): Promise<CryptoPriceInfo> {
    const result = await getHouseholdQueryClient().execute(
      'portfolio.get-instrument-quote.v1',
      {
        market: 'UPBIT_KRW',
        code: coin.code,
        name: coin.name,
        instrumentType: 'crypto',
        priceScale: 1,
      }
    );
    return {
      code: result.instrument.code,
      name: result.instrument.name,
      price: result.priceInWon,
      change: 0,
      changePercent: 0,
      previousClose: result.priceInWon,
      currency: 'KRW',
    };
  },

  async getPhysicalGoldQuote(): Promise<PortfolioQuoteQueryResult> {
    return getHouseholdQueryClient().execute('portfolio.get-instrument-quote.v1', {
      market: 'PHYSICAL_GOLD',
      code: 'KRX-GOLD-SPOT',
      name: 'KRX 금 현물',
      instrumentType: 'gold',
      priceScale: 1,
    });
  },

  async getDividendProjection(
    instrumentCode: string
  ): Promise<PortfolioDividendProjectionQueryResult> {
    return getHouseholdQueryClient().execute('portfolio.get-dividend-projection.v1', {
      instrumentCode,
    });
  },
};

import { LocalStockInstrumentCatalog } from '@/features/portfolio/instrument-catalog/application/localStockInstrumentCatalog';
import type {
  StockInstrumentCatalogCache,
  StockInstrumentCatalogRemote,
} from '@/features/portfolio/instrument-catalog/application/stockInstrumentCatalogPorts';
import type {
  StockCatalogManifest,
  StockCatalogSnapshot,
} from '@/features/portfolio/instrument-catalog/domain/stockInstrumentCatalog';

const manifest: StockCatalogManifest = {
  schemaVersion: 1,
  catalogVersion: 'v1',
  snapshotObject: 'market-catalog/v1/snapshots/2026-07-23/v1.json.gz',
  snapshotGeneration: 'generation-1',
  asOfDate: '2026-07-23',
  publishedAt: '2026-07-23T06:00:00+09:00',
  sha256: 'a'.repeat(64),
  itemCount: 2,
};

const snapshot: StockCatalogSnapshot = {
  manifest,
  items: [
    {
      market: 'KRX',
      instrumentType: 'STOCK',
      code: '005930',
      name: '삼성전자',
    },
    {
      market: 'US',
      instrumentType: 'ETF',
      code: 'SPY',
      name: 'SPDR S&P 500 ETF Trust',
    },
  ],
};

function cache(initial?: StockCatalogSnapshot): StockInstrumentCatalogCache & {
  write: jest.Mock;
} {
  return {
    read: jest.fn().mockResolvedValue(initial),
    write: jest.fn().mockResolvedValue(undefined),
  };
}

describe('local stock instrument catalog contract', () => {
  test('returns a cached result without waiting for a remote manifest request', async () => {
    const remote: StockInstrumentCatalogRemote = {
      readManifest: jest.fn(
        () => new Promise<StockCatalogManifest>(() => undefined)
      ),
      readSnapshot: jest.fn(),
    };
    const subject = new LocalStockInstrumentCatalog(remote, cache(snapshot));

    await expect(subject.search('삼성전자')).resolves.toEqual([
      {
        market: 'KRX',
        instrumentType: 'stock',
        code: '005930',
        name: '삼성전자',
      },
    ]);
    expect(remote.readSnapshot).not.toHaveBeenCalled();
  });

  test('downloads and persists the catalog once when the device cache is empty', async () => {
    const localCache = cache();
    const remote: StockInstrumentCatalogRemote = {
      readManifest: jest.fn().mockResolvedValue(manifest),
      readSnapshot: jest.fn().mockResolvedValue(snapshot),
    };
    const subject = new LocalStockInstrumentCatalog(remote, localCache);

    await expect(subject.search('SPY')).resolves.toEqual([
      {
        market: 'US',
        instrumentType: 'etf',
        code: 'US:SPY',
        name: 'SPDR S&P 500 ETF Trust',
      },
    ]);
    await expect(subject.search('삼성')).resolves.toHaveLength(1);
    expect(remote.readManifest).toHaveBeenCalledTimes(1);
    expect(remote.readSnapshot).toHaveBeenCalledTimes(1);
    expect(localCache.write).toHaveBeenCalledWith(snapshot);
  });

  test('keeps the last successful device snapshot when refresh fails', async () => {
    const remote: StockInstrumentCatalogRemote = {
      readManifest: jest.fn().mockRejectedValue(new Error('offline')),
      readSnapshot: jest.fn(),
    };
    const subject = new LocalStockInstrumentCatalog(remote, cache(snapshot));

    await expect(subject.warm()).resolves.toBeUndefined();
    await expect(subject.search('005930')).resolves.toHaveLength(1);
  });

  test('includes the supported fund and preserves the established ranking contract', async () => {
    const subject = new LocalStockInstrumentCatalog(
      {
        readManifest: jest.fn().mockResolvedValue(manifest),
        readSnapshot: jest.fn().mockResolvedValue(snapshot),
      },
      cache(snapshot)
    );

    await expect(subject.search('EW001')).resolves.toMatchObject([
      {
        market: 'KOFIA_FUND',
        instrumentType: 'fund',
        code: 'FUND:K55301EW0012',
        priceScale: 1_000,
      },
    ]);
  });
});

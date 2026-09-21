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
  test('[MARKET-003][T-MARKET-005] 넓은 부분 검색에서도 12번째 RISE를 포함하고 중복 없이 모든 결과를 반환한다', async () => {
    const entries = [
      ['0015B0', 'KoAct 미국나스닥성장기업액티브'],
      ['0019K0', 'TIME 미국나스닥100채권혼합50액티브'],
      ['0069M0', '1Q 미국나스닥100'],
      ['0089B0', 'PLUS 미국나스닥100미국채혼합50'],
      ['0104H0', 'KoAct 미국나스닥채권혼합50액티브'],
      ['0111P0', '1Q 미국나스닥100미국채혼합50액티브'],
      ['133690', 'TIGER 미국나스닥100'],
      ['203780', 'TIGER 미국나스닥바이오'],
      ['287180', 'PLUS 미국나스닥테크'],
      ['304940', 'KODEX 미국나스닥100선물(H)'],
      ['367380', 'ACE 미국나스닥100'],
      ['368590', 'RISE 미국나스닥100'],
      ['379810', 'KODEX 미국나스닥100'],
    ].map(([code, name]) => ({ code, name, market: 'KRX' as const, instrumentType: 'ETF' as const }));
    const items = [...entries].reverse().concat(entries[11]);
    const remote = { readManifest: jest.fn(), readSnapshot: jest.fn() };
    const subject = new LocalStockInstrumentCatalog(remote,
      cache({ manifest: { ...manifest, itemCount: items.length }, items }), () => 0);

    const broad = await subject.search('미국나스닥');
    expect(broad.map(({ code }) => code)).toEqual(entries.map(({ code }) => code));
    expect(broad[11]).toMatchObject({ code: '368590', name: 'RISE 미국나스닥100' });
    const narrow = await subject.search('미국나스닥100');
    expect(narrow).toHaveLength(9);
    expect(narrow[7]).toMatchObject({ code: '368590' });
    await expect(subject.search('미국 나스닥')).resolves.toEqual(broad);
    await expect(subject.search('  ')).resolves.toEqual([]);
    expect(remote.readManifest).not.toHaveBeenCalled();
  });

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

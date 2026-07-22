import type { StockSearchResult } from '@/types/asset';
import type {
  StockInstrumentCatalogCache,
  StockInstrumentCatalogRemote,
} from './stockInstrumentCatalogPorts';
import {
  prepareStockCatalog,
  searchPreparedStockCatalog,
  type StockCatalogInstrument,
  type StockCatalogSnapshot,
} from '../domain/stockInstrumentCatalog';

const DEFAULT_REMOTE_CHECK_INTERVAL_MS = 5 * 60 * 1_000;

export const NATIONAL_GROWTH_FUND: StockCatalogInstrument = {
  market: 'KOFIA_FUND',
  instrumentType: 'FUND',
  code: 'FUND:K55301EW0012',
  name: '미래에셋국민참여형국민성장혼합자산투자신탁(사모투자재간접형) 종류 C-e',
  aliases: ['국민성장펀드', '국민성장', 'EW001', '539500', '539502'],
  priceScale: 1_000,
};

export class LocalStockInstrumentCatalog {
  private snapshot?: StockCatalogSnapshot;
  private prepared = prepareStockCatalog([]);
  private hydratePromise?: Promise<void>;
  private refreshPromise?: Promise<void>;
  private lastRemoteCheckAt = 0;

  constructor(
    private readonly remote: StockInstrumentCatalogRemote,
    private readonly cache: StockInstrumentCatalogCache,
    private readonly now: () => number = Date.now,
    private readonly remoteCheckIntervalMs = DEFAULT_REMOTE_CHECK_INTERVAL_MS,
    private readonly supplemental: readonly StockCatalogInstrument[] = [
      NATIONAL_GROWTH_FUND,
    ]
  ) {}

  async warm(): Promise<void> {
    await this.hydrateFromCache();
    await this.refresh(false);
  }

  async search(query: string, limit = 10): Promise<StockSearchResult[]> {
    if (query.trim() === '') return [];
    await this.hydrateFromCache();

    if (this.snapshot === undefined) {
      await this.refresh(true);
    } else if (this.isRemoteCheckDue()) {
      void this.refresh(false);
    }

    return searchPreparedStockCatalog(this.prepared, query, limit);
  }

  private async hydrateFromCache(): Promise<void> {
    this.hydratePromise ??= (async () => {
      try {
        const cached = await this.cache.read();
        if (cached !== undefined) this.replaceSnapshot(cached);
      } catch {
        // IndexedDB를 사용할 수 없어도 원격 카탈로그 검색은 계속할 수 있습니다.
      }
    })();
    await this.hydratePromise;
  }

  private isRemoteCheckDue(): boolean {
    return this.now() - this.lastRemoteCheckAt >= this.remoteCheckIntervalMs;
  }

  private async refresh(required: boolean): Promise<void> {
    if (!required && !this.isRemoteCheckDue()) return;
    if (this.refreshPromise !== undefined) {
      if (required) await this.refreshPromise;
      return;
    }

    this.refreshPromise = (async () => {
      this.lastRemoteCheckAt = this.now();
      try {
        const manifest = await this.remote.readManifest();
        if (
          this.snapshot?.manifest.sha256 === manifest.sha256 &&
          this.snapshot.manifest.snapshotGeneration === manifest.snapshotGeneration
        ) {
          return;
        }
        const snapshot = await this.remote.readSnapshot(manifest);
        this.replaceSnapshot(snapshot);
        try {
          await this.cache.write(snapshot);
        } catch {
          // 영속 캐시 저장 실패는 현재 검색 결과를 무효화하지 않습니다.
        }
      } catch (error) {
        if (this.snapshot === undefined) throw error;
      }
    })();

    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = undefined;
    }
  }

  private replaceSnapshot(snapshot: StockCatalogSnapshot): void {
    this.snapshot = snapshot;
    this.prepared = prepareStockCatalog([...snapshot.items, ...this.supplemental]);
  }
}


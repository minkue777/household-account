import type {
  StockCatalogManifest,
  StockCatalogSnapshot,
} from '../domain/stockInstrumentCatalog';

export interface StockInstrumentCatalogRemote {
  readManifest(): Promise<StockCatalogManifest>;
  readSnapshot(manifest: StockCatalogManifest): Promise<StockCatalogSnapshot>;
}

export interface StockInstrumentCatalogCache {
  read(): Promise<StockCatalogSnapshot | undefined>;
  write(snapshot: StockCatalogSnapshot): Promise<void>;
}


import { LocalStockInstrumentCatalog } from '@/features/portfolio/instrument-catalog/application/localStockInstrumentCatalog';
import { FirebaseStorageStockInstrumentCatalogRemote } from '@/platform/instrument-catalog/firebaseStorageStockInstrumentCatalogRemote';
import { IndexedDbStockInstrumentCatalogCache } from '@/platform/instrument-catalog/indexedDbStockInstrumentCatalogCache';

let catalog: LocalStockInstrumentCatalog | undefined;

export function getStockInstrumentCatalog(): LocalStockInstrumentCatalog {
  catalog ??= new LocalStockInstrumentCatalog(
    new FirebaseStorageStockInstrumentCatalogRemote(),
    new IndexedDbStockInstrumentCatalogCache()
  );
  return catalog;
}

export async function warmStockInstrumentCatalog(): Promise<void> {
  await getStockInstrumentCatalog().warm();
}


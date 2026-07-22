import type { StockInstrumentCatalogCache } from '@/features/portfolio/instrument-catalog/application/stockInstrumentCatalogPorts';
import {
  parseStockCatalogSnapshot,
  type StockCatalogSnapshot,
} from '@/features/portfolio/instrument-catalog/domain/stockInstrumentCatalog';

const DATABASE_NAME = 'household-account-reference-data';
const DATABASE_VERSION = 1;
const STORE_NAME = 'instrument-catalog';
const LATEST_KEY = 'latest-v1';

interface StoredSnapshot {
  readonly key: string;
  readonly snapshot: StockCatalogSnapshot;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('INDEXED_DB_REQUEST_FAILED'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('INDEXED_DB_TRANSACTION_FAILED'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('INDEXED_DB_TRANSACTION_ABORTED'));
  });
}

export class IndexedDbStockInstrumentCatalogCache
  implements StockInstrumentCatalogCache
{
  private databasePromise?: Promise<IDBDatabase | undefined>;

  async read(): Promise<StockCatalogSnapshot | undefined> {
    const database = await this.database();
    if (database === undefined) return undefined;
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const stored = (await requestResult(
      transaction.objectStore(STORE_NAME).get(LATEST_KEY)
    )) as StoredSnapshot | undefined;
    if (stored === undefined) return undefined;
    try {
      return parseStockCatalogSnapshot(stored.snapshot);
    } catch {
      return undefined;
    }
  }

  async write(snapshot: StockCatalogSnapshot): Promise<void> {
    const database = await this.database();
    if (database === undefined) return;
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ key: LATEST_KEY, snapshot });
    await transactionComplete(transaction);
  }

  private database(): Promise<IDBDatabase | undefined> {
    this.databasePromise ??= this.openDatabase();
    return this.databasePromise;
  }

  private async openDatabase(): Promise<IDBDatabase | undefined> {
    if (typeof globalThis.indexedDB === 'undefined') return undefined;
    try {
      const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        }
      };
      return await requestResult(request);
    } catch {
      return undefined;
    }
  }
}


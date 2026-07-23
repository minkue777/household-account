import { app } from '@/lib/firebaseApp';
import type { StockInstrumentCatalogRemote } from '@/features/portfolio/instrument-catalog/application/stockInstrumentCatalogPorts';
import {
  parseStockCatalogManifest,
  parseStockCatalogSnapshot,
  type StockCatalogInstrument,
  type StockCatalogManifest,
  type StockCatalogSnapshot,
} from '@/features/portfolio/instrument-catalog/domain/stockInstrumentCatalog';

const MANIFEST_OBJECT = 'market-catalog/v1/latest.json';
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_COMPRESSED_SNAPSHOT_BYTES = 4 * 1024 * 1024;

interface StoredCatalogBody {
  readonly schemaVersion: unknown;
  readonly asOfDate: unknown;
  readonly catalogVersion: unknown;
  readonly itemCount: unknown;
  readonly items: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJson(bytes: ArrayBuffer): unknown {
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

async function gunzip(bytes: ArrayBuffer): Promise<unknown> {
  if (typeof globalThis.DecompressionStream === 'undefined') {
    throw new Error('INSTRUMENT_CATALOG_GZIP_UNSUPPORTED');
  }
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text()) as unknown;
}

function parseStoredBody(
  value: unknown,
  manifest: StockCatalogManifest
): readonly StockCatalogInstrument[] {
  if (!isRecord(value)) throw new Error('INSTRUMENT_CATALOG_SNAPSHOT_INVALID');
  const body = value as unknown as StoredCatalogBody;
  if (
    body.schemaVersion !== 1 ||
    body.asOfDate !== manifest.asOfDate ||
    body.catalogVersion !== manifest.catalogVersion ||
    body.itemCount !== manifest.itemCount ||
    !Array.isArray(body.items) ||
    body.items.length !== manifest.itemCount
  ) {
    throw new Error('INSTRUMENT_CATALOG_SNAPSHOT_INVALID');
  }

  return body.items as readonly StockCatalogInstrument[];
}

export class FirebaseStorageStockInstrumentCatalogRemote
  implements StockInstrumentCatalogRemote
{
  async readManifest(): Promise<StockCatalogManifest> {
    const { getBytes, getStorage, ref } = await import('firebase/storage');
    const bytes = await getBytes(
      ref(getStorage(app), MANIFEST_OBJECT),
      MAX_MANIFEST_BYTES
    );
    return parseStockCatalogManifest(parseJson(bytes));
  }

  async readSnapshot(
    manifest: StockCatalogManifest
  ): Promise<StockCatalogSnapshot> {
    const { getBytes, getMetadata, getStorage, ref } = await import(
      'firebase/storage'
    );
    const snapshotRef = ref(getStorage(app), manifest.snapshotObject);
    const [bytes, metadata] = await Promise.all([
      getBytes(snapshotRef, MAX_COMPRESSED_SNAPSHOT_BYTES),
      getMetadata(snapshotRef),
    ]);
    if (metadata.generation !== manifest.snapshotGeneration) {
      throw new Error('INSTRUMENT_CATALOG_GENERATION_MISMATCH');
    }
    if ((await sha256(bytes)) !== manifest.sha256) {
      throw new Error('INSTRUMENT_CATALOG_CHECKSUM_MISMATCH');
    }
    const items = parseStoredBody(await gunzip(bytes), manifest);
    return parseStockCatalogSnapshot({ manifest, items });
  }
}

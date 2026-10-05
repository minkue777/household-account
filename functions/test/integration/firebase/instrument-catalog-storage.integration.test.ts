import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FirebaseInstrumentCatalogStorage } from '../../../src/adapters/firebase/portfolio/firebaseInstrumentCatalog';
import { createInstrumentCatalogApplication } from '../../../src/contexts/portfolio/holdings/application/instrumentCatalogApplication';
import type { CatalogInstrument } from '../../../src/contexts/portfolio/holdings/domain/model/instrumentSearch';

const emulator = process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_STORAGE_EMULATOR_HOST ? describe : describe.skip;
emulator('[T-MARKET-002][MARKET-005] 실제 SDK 종목 목록 발행', () => {
  const app = initializeApp({ projectId: 'demo-catalog-storage', storageBucket: 'demo-catalog-storage.appspot.com' }, 'catalog-storage');
  const db = getFirestore(app);
  const bucket = getStorage(app).bucket();
  const storage = new FirebaseInstrumentCatalogStorage(db, bucket);
  const items: CatalogInstrument[] = [
    { code: '368590', market: 'KRX', name: 'RISE 미국나스닥100', instrumentType: 'ETF' },
    { code: 'AAPL', market: 'US', name: 'Apple', instrumentType: 'STOCK' },
  ];
  const latest = bucket.file('market-catalog/v1/latest.json');
  beforeEach(async () => { await bucket.deleteFiles({ force: true }); await db.recursiveDelete(db.collection('operations')); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => deleteApp(app));
  function application() {
    return createInstrumentCatalogApplication({
      runSource: { load: async () => {
        const current = await storage.readManifest();
        return { domesticSource: { kind: 'success', items: items.slice(0, 1) }, usSource: { kind: 'success', items: items.slice(1) },
          ...(current.kind === 'available' ? { expectedManifestGeneration: current.value.manifestGeneration } : {}) };
      } },
      publicationStore: storage, readStore: storage, minimumSourceCounts: { domestic: 1, us: 1 },
    });
  }
  const command = (date: string) => ({ runId: `catalog:${date}`, asOfDate: date });
  const draft = (date: string) => ({ asOfDate: date, items, domesticCount: 1, usCount: 1 });

  it('실제 gzip·checksum·generation·receipt를 반환하고 같은 명령은 다시 업로드하지 않는다', async () => {
    const service = application();
    const result = await service.publish(command('2026-10-01'));
    expect(result.kind).toBe('published');
    if (result.kind !== 'published') throw new Error('publish failed');
    const file = bucket.file(result.manifest.snapshotObject);
    const [[buffer], [metadata]] = await Promise.all([file.download(), file.getMetadata()]);
    expect(result.manifest.snapshotObject).toBe('market-catalog/v1/snapshots/2026-10-01/v1.json.gz');
    expect(result.manifest.sha256).toBe(createHash('sha256').update(buffer).digest('hex'));
    expect(result.manifest.snapshotGeneration).toBe(String(metadata.generation));
    expect(JSON.parse(gunzipSync(buffer).toString())).toEqual({ schemaVersion: 1, catalogVersion: 'v1', asOfDate: '2026-10-01', itemCount: 2, items });
    expect(await storage.findReceipt(command('2026-10-01').runId)).toEqual(result);
    const commit = vi.spyOn(storage, 'commit');
    expect(await service.publish(command('2026-10-01'))).toEqual(result);
    expect(commit).not.toHaveBeenCalled();
    expect(await service.read({ now: '2026-10-01T08:00:00Z' })).toMatchObject({ kind: 'success', snapshot: { items }, stale: false });
  });

  it('최근 세 발행 날짜를 보존한다', async () => {
    const service = application();
    await bucket.file('market-catalog/v1/snapshots/2099-01-01/v1.json.gz').save(Buffer.from('unpublished orphan'));
    for (const day of ['01', '02', '03', '04']) expect((await service.publish(command(`2026-10-${day}`))).kind).toBe('published');
    const [files] = await bucket.getFiles({ prefix: 'market-catalog/v1/snapshots/' });
    expect(files.map(file => file.name).filter(name => name.includes('/2026-')).sort()).toEqual(['02', '03', '04'].map(day => `market-catalog/v1/snapshots/2026-10-${day}/v1.json.gz`));
    expect(await storage.readManifest()).toMatchObject({ kind: 'available', value: { asOfDate: '2026-10-04' } });
  });

  it('동일 날짜의 다른 본문과 오래된 manifest generation은 기존 latest와 receipt를 바꾸지 않는다', async () => {
    await application().publish(command('2026-10-01'));
    const before = await latest.download();
    await expect(storage.commit({ runId: 'conflicting-body', draft: { ...draft('2026-10-01'), items: [] }, retainSuccessfulDays: 3 })).rejects.toThrow('IMMUTABLE_SNAPSHOT_CONFLICT');
    expect(await storage.commit({ runId: 'stale-generation', draft: draft('2026-10-02'), expectedManifestGeneration: 'stale', retainSuccessfulDays: 3 })).toBe('generation-conflict');
    expect(await latest.download()).toEqual(before);
    expect(await storage.findReceipt('conflicting-body')).toBeUndefined();
    expect(await storage.findReceipt('stale-generation')).toBeUndefined();
  });

  it('업로드된 객체 재조회 checksum 불일치는 latest 공개 전에 실패한다', async () => {
    await application().publish(command('2026-10-01'));
    const before = await latest.download();
    const prototype = Object.getPrototypeOf(bucket.file('unused'));
    const download = prototype.download;
    vi.spyOn(prototype, 'download').mockImplementation(function (this: { name: string }, ...args: unknown[]) {
      return this.name.includes('/2026-10-02/') ? Promise.resolve([Buffer.from('corrupt')]) : download.apply(this, args);
    });
    await expect(application().publish(command('2026-10-02'))).rejects.toThrow('CATALOG_SNAPSHOT_VERIFICATION_FAILED');
    expect(await latest.download()).toEqual(before);
    expect(await storage.findReceipt(command('2026-10-02').runId)).toBeUndefined();
  });

  it('latest 저장은 조회한 generation precondition을 넘기며 CAS 실패를 성공 receipt로 만들지 않는다', async () => {
    const service = application();
    const initial = await service.publish(command('2026-10-01'));
    if (initial.kind !== 'published') throw new Error('initial publish failed');
    const before = await latest.download();
    const prototype = Object.getPrototypeOf(latest);
    const save = prototype.save;
    const writes: any[] = [];
    vi.spyOn(prototype, 'save').mockImplementation(function (this: { name: string }, buffer: unknown, options: any) {
      if (this.name === latest.name) { writes.push(options); return Promise.reject(Object.assign(new Error('precondition'), { code: 412 })); }
      return save.call(this, buffer, options);
    });
    await expect(service.publish(command('2026-10-02'))).rejects.toThrow('precondition');
    expect(writes).toEqual([expect.objectContaining({ preconditionOpts: { ifGenerationMatch: Number(initial.manifest.manifestGeneration) } })]);
    expect(await latest.download()).toEqual(before);
    expect(await storage.findReceipt(command('2026-10-02').runId)).toBeUndefined();
  });
});

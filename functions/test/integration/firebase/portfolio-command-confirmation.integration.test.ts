import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FirebasePortfolioRuntimeStore } from '../../../src/adapters/firebase/portfolio/firebasePortfolioRuntimeStore';
import { receiptDocument, receiptReference } from '../../../src/adapters/firebase/portfolio/firebasePortfolioRuntimeDocuments';
import { createPortfolioRuntimeApplication } from '../../../src/contexts/portfolio/core/application/portfolioRuntimeApplication';
import type { PortfolioCommandResult, PortfolioCommandMetadata } from '../../../src/contexts/portfolio/core/application/ports/out/portfolioRuntimeStorePort';

const projectId = 'demo-portfolio-command-confirmation';
const occurredAt = '2026-07-21T09:00:00.000Z';
const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let app: App; let db: Firestore;
const metadata = (id: string): PortfolioCommandMetadata => ({ householdId: 'house', principalUid: 'uid', actorMemberId: 'member',
  commandId: id, idempotencyKey: id, commandName: 'portfolio-test', payloadFingerprint: id, occurredAt });
const runtime = () => createPortfolioRuntimeApplication({ store: new FirebasePortfolioRuntimeStore(db),
  marketQuotes: { async getQuote() { throw new Error('UNEXPECTED_PROVIDER_CALL'); } } });
const asset = (name = '투자 계좌') => ({ name, type: 'stock', ownerRef: { kind: 'household' }, currency: 'KRW', currentBalance: 0, memo: '', order: 0 });
function value(result: PortfolioCommandResult) {
  expect(result.kind).toBe('success');
  if (result.kind !== 'success' || !result.value.confirmation) throw new Error('CONFIRMATION_REQUIRED');
  return result.value.confirmation;
}
async function matchesCanonical(result: PortfolioCommandResult) {
  const confirmation = value(result);
  expect(confirmation).toMatchObject({ schemaVersion: 1, occurredAt });
  for (const view of confirmation.assets) {
    const document = (await db.doc(`households/house/assets/${view.assetId}`).get()).data()!;
    const { createdAt: created, updatedAt: updated, schemaVersion: _schema, ...business } = document;
    expect(business).toEqual(view);
    expect(created).toBeInstanceOf(Timestamp); expect(updated).toBeInstanceOf(Timestamp);
    expect(updated.toDate().toISOString()).not.toBe(occurredAt);
    expect(view).not.toHaveProperty('updatedAt'); expect(view).not.toHaveProperty('createdAt');
  }
  for (const view of confirmation.positions) {
    const document = (await db.doc(`households/house/assets/${view.assetId}/positions/${view.positionId}`).get()).data()!;
    const { createdAt: _created, updatedAt: _updated, schemaVersion: _schema, instrument: _instrument, ...business } = document;
    expect(business).toEqual(view);
  }
  return confirmation;
}

suite('포트폴리오 확정 응답과 실제 canonical 저장', () => {
  beforeAll(() => { app = initializeApp({ projectId }, projectId); db = getFirestore(app); });
  beforeEach(async () => {
    const response = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${projectId}/databases/(default)/documents`, { method: 'DELETE' });
    if (!response.ok) throw new Error('EMULATOR_RESET_FAILED');
  });
  afterAll(async () => { if (app) await deleteApp(app); });

  it('[AST-001][AST-003][AST-006] 정규화·선택 필드 제거·순서·삭제 결과와 receipt 재생이 저장한 업무 값과 같다', async () => {
    const created = await runtime().createAsset({ metadata: metadata('create'), asset: { ...asset('  계좌  '), icon: 'wallet' } });
    const assetId = (await matchesCanonical(created)).assets[0].assetId;
    expect(value(created).assets[0].name).toBe('계좌');
    const input = { metadata: metadata('update'), assetId, expectedVersion: 1, changes: { name: '  변경  ', memo: '메모', icon: '' } };
    const updated = await runtime().updateAsset(input);
    expect((await matchesCanonical(updated)).assets[0]).toMatchObject({ name: '변경', memo: '메모', aggregateVersion: 2 });
    expect(value(updated).assets[0]).not.toHaveProperty('icon');
    expect(await runtime().updateAsset(input)).toEqual(updated);
    await runtime().createAsset({ metadata: metadata('second'), asset: { ...asset('둘째'), order: 1 } });
    const reorder = await runtime().reorderAssets({ metadata: metadata('order'), assets: [{ assetId, order: 1 }, { assetId: 'asset-house-second', order: 0 }],
      expectedVersions: { [assetId]: 2, 'asset-house-second': 1 } });
    expect((await matchesCanonical(reorder)).assets).toHaveLength(2);
    const deleted = await runtime().deleteAsset({ metadata: metadata('delete'), assetId, expectedVersion: 3 });
    expect((await matchesCanonical(deleted)).assets[0]).toMatchObject({ lifecycleState: 'deleted', aggregateVersion: 4 });
  });

  it('[HOLD-001][HOLD-002][HOLD-003] 종목과 부모 자산의 확정 값을 함께 반환하고 같은 버전의 동시 수정은 하나만 반영한다', async () => {
    const created = await runtime().createAsset({ metadata: metadata('create'), asset: asset() });
    const assetId = value(created).assets[0].assetId;
    const added = await runtime().addPosition({ metadata: metadata('add'), assetId, positionKind: 'stock', expectedAssetVersion: 1,
      position: { stockCode: '368590', stockName: 'RISE 미국나스닥100', market: 'KRX', currency: 'KRW', quantity: 10, avgPrice: 10000, currentPrice: 12000 } });
    const confirmed = await matchesCanonical(added);
    const positionId = confirmed.positions[0].positionId;
    expect(confirmed.assets[0]).toMatchObject({ aggregateVersion: 2, currentBalance: 120000 });
    const update = (id: string, quantity: number) => runtime().updatePosition({ metadata: metadata(id), assetId, positionId,
      positionKind: 'stock', expectedVersion: 1, expectedAssetVersion: 2, changes: { quantity } });
    const results = await Promise.all([update('update-a', 12), update('update-b', 14)]);
    expect(results.filter(result => result.kind === 'success')).toHaveLength(1);
    expect(results.find(result => result.kind === 'error')).toMatchObject({ kind: 'error', code: 'ASSET_VERSION_MISMATCH' });
    const winner = results.find(result => result.kind === 'success')!;
    await matchesCanonical(winner);
    const deleted = await runtime().deletePosition({ metadata: metadata('delete-position'), assetId, positionId, positionKind: 'stock', expectedVersion: 2, expectedAssetVersion: 3 });
    const removed = await matchesCanonical(deleted);
    expect(removed.positions[0]).toMatchObject({ lifecycleState: 'deleted', aggregateVersion: 3 });
    expect(removed.assets[0]).toMatchObject({ currentBalance: 0, aggregateVersion: 4 });
  }, 30_000);

  it('[AST-003] 이전 receipt에는 확정 객체를 합성하지 않고 과거 결과 그대로 재생한다', async () => {
    const old = metadata('old');
    await receiptReference(db, old).set(receiptDocument(old, { kind: 'success', value: {} }));
    expect(await runtime().updateAsset({ metadata: old, assetId: 'no-such-asset', expectedVersion: 10, changes: { name: '재생' } }))
      .toEqual({ kind: 'success', value: {} });
    expect((await db.collection('households/house/assets').get()).empty).toBe(true);
  });
});

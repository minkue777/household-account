import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const project = 'demo-household-asset-history-migration';
const exec = promisify(execFile);
const suite = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
let app: App;
let db: Firestore;
async function run(...args: string[]) {
  const { stdout } = await exec(process.execPath, [fileURLToPath(new URL('../../../scripts/migrate-asset-history.mjs', import.meta.url)), '--project', project, ...args], {
    // Prove that the emulator CLI does not depend on this developer's saved ADC.
    env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: fileURLToPath(new URL('./absent-emulator-credentials.json', import.meta.url)) },
  });
  return JSON.parse(stdout.trim());
}
async function seed(household: string, date: string, amounts: Record<string, number>) {
  for (const [assetId, balance] of Object.entries(amounts)) {
    await db.collection('asset_history').doc(`${household}_${date}_${assetId}`).set({ householdId: household, date, assetId, balance });
  }
}
suite('asset_history 운영 마이그레이션 CLI', () => {
  beforeAll(() => { app = initializeApp({ projectId: project }, project); db = getFirestore(app); });
  beforeEach(async () => {
    const result = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${project}/databases/(default)/documents`, { method: 'DELETE' });
    if (!result.ok) throw new Error('EMULATOR_RESET_FAILED');
  });
  afterAll(async () => { if (app) await deleteApp(app); });

  it('가구별 과거 금액·음수·0원·명의자를 보존하고 기존 snapshot과 원본은 변경하지 않으며 재실행은 쓰지 않습니다', async () => {
    await db.doc('households/a/assetOwnerProfiles/child').set({ displayName: '아이' });
    await db.doc('households/b/assetOwnerProfiles/other').set({ displayName: '아이' });
    await seed('a', '2020-01-01', { TOTAL: 70, FINANCIAL: 100, TYPE_stock: 100, TYPE_loan: -30, OWNER_아이: 70 });
    await seed('a', '2020-01-02', { TOTAL: 0, FINANCIAL: 0 });
    await seed('b', '2020-01-01', { TOTAL: 200, FINANCIAL: 200, OWNER_아이: 200 });
    await seed('a', '2026-09-01', { TOTAL: 300, FINANCIAL: 300 });
    const current = db.doc('households/a/assetSnapshots/2026-09-01');
    await current.set({ householdId: 'a', localDate: '2026-09-01', total: 300, financial: 300, byType: { stock: 300 }, byOwnerRefKey: {}, sourceCheckpoint: 'live' });
    const before = await current.get();
    const legacyBefore = await db.collection('asset_history').get();
    const plan = await run();
    expect(plan).toMatchObject({ mode: 'dry-run', missingDays: 3, verifiedValues: 2 });
    expect((await db.collectionGroup('assetSnapshots').get()).size).toBe(1);
    const result = await run('--apply', '--confirm-project', project, '--expected-plan-hash', plan.planHash);
    expect(result).toMatchObject({ mode: 'applied-and-verified', missingDays: 0, verifiedValues: 12 });
    expect((await db.doc('households/a/assetSnapshots/2020-01-01').get()).data()).toMatchObject({
      total: 70, financial: 100, byType: { stock: 100, loan: -30 }, byOwnerRefKey: { 'profile:child': 70 }, ownerDisplayNames: { 'profile:child': '아이' }, sourceAssetVersions: {},
    });
    expect((await db.doc('households/a/assetSnapshots/2020-01-02').get()).data()).toMatchObject({ total: 0, financial: 0, byType: {}, byOwnerRefKey: {} });
    expect((await db.doc('households/b/assetSnapshots/2020-01-01').get()).data()?.byOwnerRefKey).toEqual({ 'profile:other': 200 });
    expect((await current.get()).updateTime?.isEqual(before.updateTime!)).toBe(true);
    expect((await db.collection('asset_history').get()).docs.map(doc => doc.data())).toEqual(legacyBefore.docs.map(doc => doc.data()));
    const snapshots = await db.collectionGroup('assetSnapshots').get();
    const replay = await run();
    await run('--apply', '--confirm-project', project, '--expected-plan-hash', replay.planHash);
    expect((await db.collectionGroup('assetSnapshots').get()).docs.map(doc => doc.updateTime)).toEqual(snapshots.docs.map(doc => doc.updateTime));
  });

  it('기존 snapshot과 금액이 다르면 전체 apply 전에 중단합니다', async () => {
    await seed('a', '2020-01-01', { TOTAL: 1, FINANCIAL: 1 });
    await seed('a', '2020-01-02', { TOTAL: 2, FINANCIAL: 2 });
    await db.doc('households/a/assetSnapshots/2020-01-02').set({ householdId: 'a', localDate: '2020-01-02', total: 99, financial: 2 });
    await expect(run()).rejects.toThrow('CANONICAL_SNAPSHOT_CONFLICT');
    expect((await db.collectionGroup('assetSnapshots').get()).size).toBe(1);
  });

  it('검토 이후 원본이 바뀌면 이전 plan으로 쓰지 않습니다', async () => {
    await seed('a', '2020-01-01', { TOTAL: 1, FINANCIAL: 1 });
    const plan = await run();
    await seed('a', '2020-01-01', { TOTAL: 2, FINANCIAL: 2 });
    await expect(run('--apply', '--confirm-project', project, '--expected-plan-hash', plan.planHash)).rejects.toThrow('MIGRATION_PLAN_CHANGED');
    expect((await db.collectionGroup('assetSnapshots').get()).empty).toBe(true);
  });

  it.each(['unmapped', 'ambiguous'])('명의자를 추측하지 않고 %s mapping에서 중단합니다', async mode => {
    await seed('a', '2020-01-01', { TOTAL: 1, FINANCIAL: 1, OWNER_아이: 1 });
    if (mode === 'ambiguous') for (const id of ['one', 'two']) await db.doc(`households/a/assetOwnerProfiles/${id}`).set({ displayName: '아이' });
    await expect(run()).rejects.toThrow('OWNER_MAPPING_UNRESOLVED');
    expect((await db.collectionGroup('assetSnapshots').get()).empty).toBe(true);
  });
});

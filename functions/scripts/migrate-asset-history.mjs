import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const stable = value => JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === 'object' && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
const finite = value => typeof value === 'number' && Number.isFinite(value);

// Offline operational migration only: existing snapshots and source documents are never overwritten.
export async function planAssetHistoryMigration(database) {
  const [legacy, canonical, profiles] = await Promise.all([
    database.collection('asset_history').get(),
    database.collectionGroup('assetSnapshots').get(),
    database.collectionGroup('assetOwnerProfiles').get(),
  ]);
  const existing = new Map(canonical.docs.map(doc => [doc.ref.path, doc.data()]));
  const ownerKeys = new Map();
  const addOwner = (householdId, name, key) => {
    if (typeof name !== 'string' || !name) throw new Error('OWNER_NAME_INVALID');
    const nameKey = JSON.stringify([householdId, name]);
    const keys = ownerKeys.get(nameKey) ?? new Set();
    keys.add(key); ownerKeys.set(nameKey, keys);
  };
  for (const doc of profiles.docs) addOwner(doc.ref.parent.parent.id, doc.data().displayName, `profile:${doc.id}`);
  for (const doc of canonical.docs) {
    for (const [key, name] of Object.entries(doc.data().ownerDisplayNames ?? {})) {
      addOwner(doc.ref.parent.parent.id, name, key);
    }
  }
  const grouped = new Map();
  for (const doc of legacy.docs) {
    const data = doc.data();
    if (typeof data.householdId !== 'string' || !data.householdId || data.householdId.includes('/')
      || typeof data.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)
      || new Date(`${data.date}T00:00:00Z`).toISOString().slice(0, 10) !== data.date
      || typeof data.assetId !== 'string' || !finite(data.balance)) throw new Error('LEGACY_SNAPSHOT_INVALID');
    const path = `households/${data.householdId}/assetSnapshots/${data.date}`;
    const rows = grouped.get(path) ?? [];
    rows.push({ id: doc.id, data, updateTime: doc.updateTime.toDate().toISOString() }); grouped.set(path, rows);
  }
  const missing = [];
  let verifiedValues = 0;
  for (const [path, rows] of grouped) {
    const amounts = new Map();
    const byType = {}; const byOwnerRefKey = {}; const ownerDisplayNames = {};
    for (const { data } of rows) {
      if (amounts.has(data.assetId)) throw new Error('DUPLICATE_LEGACY_DIMENSION');
      amounts.set(data.assetId, data.balance);
      if (data.assetId.startsWith('TYPE_') && data.assetId.length > 5) byType[data.assetId.slice(5)] = data.balance;
      else if (data.assetId.startsWith('OWNER_') && data.assetId.length > 6) {
        const name = data.assetId.slice(6);
        const keys = ownerKeys.get(JSON.stringify([data.householdId, name]));
        if (keys?.size !== 1) throw new Error('OWNER_MAPPING_UNRESOLVED');
        const key = [...keys][0];
        if (Object.hasOwn(byOwnerRefKey, key)) throw new Error('OWNER_MAPPING_COLLISION');
        byOwnerRefKey[key] = data.balance; ownerDisplayNames[key] = name;
      } else if (data.assetId !== 'TOTAL' && data.assetId !== 'FINANCIAL') throw new Error('LEGACY_DIMENSION_UNKNOWN');
    }
    if (!amounts.has('TOTAL') || !amounts.has('FINANCIAL')) throw new Error('LEGACY_TOTAL_MISSING');
    const { householdId, date: localDate } = rows[0].data;
    const snapshot = {
      schemaVersion: 1, householdId, localDate, total: amounts.get('TOTAL'), financial: amounts.get('FINANCIAL'),
      byType, byOwnerRefKey, ownerDisplayNames, sourceAssetVersions: {},
      sourceCheckpoint: `asset-history-migration:${hash(rows)}`,
      calculatedAt: rows.map(row => row.updateTime).sort().at(-1), freshness: 'fresh',
      migration: { source: 'asset_history', sourceDocumentCount: rows.length },
    };
    const current = existing.get(path);
    if (current) {
      if (current.householdId !== householdId || current.localDate !== localDate
        || current.total !== snapshot.total || current.financial !== snapshot.financial
        || Object.entries(byType).some(([key, value]) => current.byType?.[key] !== value)
        || Object.entries(byOwnerRefKey).some(([key, value]) => current.byOwnerRefKey?.[key] !== value)) {
        throw new Error('CANONICAL_SNAPSHOT_CONFLICT');
      }
      verifiedValues += rows.length;
    } else missing.push({ path, snapshot });
  }
  missing.sort((a, b) => a.path.localeCompare(b.path));
  const sourceHash = hash(legacy.docs.map(doc => [doc.ref.path, doc.data()]).sort(([a], [b]) => a.localeCompare(b)));
  return {
    missing, sourceHash, planHash: hash({ sourceHash, missing }),
    summary: { legacyDocuments: legacy.size, legacyDays: grouped.size, canonicalDocuments: canonical.size, missingDays: missing.length, verifiedValues },
  };
}

export async function applyAssetHistoryMigration(database, plan, expectedPlanHash) {
  if (plan.planHash !== expectedPlanHash) throw new Error('MIGRATION_PLAN_CHANGED');
  // create() preconditions also protect snapshots produced concurrently by the live projector.
  for (let offset = 0; offset < plan.missing.length; offset += 100) {
    const batch = database.batch();
    for (const { path, snapshot } of plan.missing.slice(offset, offset + 100)) {
      batch.create(database.doc(path), { ...snapshot, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();
  }
  const verified = await planAssetHistoryMigration(database);
  if (verified.sourceHash !== plan.sourceHash || verified.missing.length !== 0) throw new Error('MIGRATION_VERIFICATION_FAILED');
  return verified.summary;
}

async function main() {
  const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
  const projectId = option('--project');
  if (!projectId || (!projectId.startsWith('demo-') && projectId !== 'household-account-6f300')) throw new Error('PROJECT_INVALID');
  if (!projectId.startsWith('demo-') && process.env.FIRESTORE_EMULATOR_HOST) throw new Error('PRODUCTION_EMULATOR_MIXED');
  const apply = process.argv.includes('--apply');
  if (apply && (option('--confirm-project') !== projectId || !option('--expected-plan-hash'))) throw new Error('APPLY_SCOPE_REQUIRED');
  const app = initializeApp({ projectId, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
  try {
    const database = getFirestore(app); database.settings({ preferRest: true });
    const plan = await planAssetHistoryMigration(database);
    const summary = apply ? await applyAssetHistoryMigration(database, plan, option('--expected-plan-hash')) : plan.summary;
    console.log(JSON.stringify({ mode: apply ? 'applied-and-verified' : 'dry-run', planHash: plan.planHash, ...summary }));
  } finally { await deleteApp(app); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.code ?? error.message); process.exitCode = 1; });
}

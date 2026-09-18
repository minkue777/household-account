import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { decode, encode, inspect } from './consolidate-storage.mjs';

const collections = {
  expenses: 'ledgerTransactions', assets: 'assets', registered_cards: 'registeredCards',
  merchant_rules: 'merchantRules', stock_holdings: 'positions', crypto_holdings: 'positions', categories: 'categoryCatalog',
};
const revision = doc => doc.exists ? `${doc.updateTime.seconds}:${doc.updateTime.nanoseconds}` : null;
const stable = value => value !== null && typeof value === 'object'
  ? Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  : JSON.stringify(value);
const digest = value => createHash('sha256').update(stable(value)).digest('hex');
function assertBackupValue(value) {
  if (value instanceof Timestamp || value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) { value.forEach(assertBackupValue); return; }
  if (value && Object.getPrototypeOf(value) === Object.prototype) { Object.values(value).forEach(assertBackupValue); return; }
  throw new Error('UNSUPPORTED_BACKUP_VALUE');
}

function destination(path, data) {
  const segments = path.split('/');
  if (segments.length === 4 && segments[0] === 'households'
    && (segments[2] === 'categories' || (segments[2] === 'categorySettings' && segments[3] === 'default'))) {
    return `households/${segments[1]}/categoryCatalog/current`;
  }
  const [collection, id] = segments;
  if (segments.length !== 2 || !Object.hasOwn(collections, collection)) throw new Error('DELETE_PATH_NOT_ALLOWED');
  if (typeof data.householdId !== 'string' || !data.householdId || data.householdId.includes('/')) throw new Error('HOUSEHOLD_UNRESOLVED');
  const household = `households/${data.householdId}`;
  if (collections[collection] === 'positions') {
    if (typeof data.assetId !== 'string' || !data.assetId || data.assetId.includes('/')) throw new Error('ASSET_UNRESOLVED');
    return `${household}/assets/${data.assetId}/positions/${id}`;
  }
  return `${household}/${collections[collection]}/${collection === 'categories' ? 'current' : id}`;
}

function canonicalDependencies(path) {
  const parts = path.split('/');
  return parts.length === 6 && parts[2] === 'assets' && parts[4] === 'positions'
    ? [parts.slice(0, 4).join('/')] : [];
}

async function getPages(db, paths) {
  const result = [];
  for (let offset = 0; offset < paths.length; offset += 250) {
    result.push(...await db.getAll(...paths.slice(offset, offset + 250).map(path => db.doc(path))));
  }
  return result;
}

/** Full source backup plus a semantic reconciliation; this never changes a document. */
export async function planCleanup(db, validateCatalog) {
  const householdSnapshot = await db.collection('households').get();
  const households = new Set(householdSnapshot.docs.map(doc => doc.id));
  const context = [...householdSnapshot.docs];
  const sources = [];
  for (const name of Object.keys(collections)) sources.push(...(await db.collection(name).get()).docs);
  for (const household of householdSnapshot.docs) {
    for (const name of ['categories', 'categorySettings', 'members', 'assetOwnerProfiles']) {
      const documents = (await household.ref.collection(name).get()).docs;
      if (name === 'categories') sources.push(...documents);
      else if (name === 'categorySettings') {
        if (documents.some(doc => doc.id !== 'default')) throw new Error('UNKNOWN_CATEGORY_SETTINGS');
        sources.push(...documents);
      } else context.push(...documents);
    }
  }
  const deletions = sources.map(doc => {
    const data = doc.data();
    assertBackupValue(data);
    // The typed timestamp marker must not reinterpret an ordinary source map.
    // Verify the actual JSON artifact round trip before allowing any deletion plan.
    if (!isDeepStrictEqual(data, decode(JSON.parse(JSON.stringify(encode(data)))))) {
      throw new Error('BACKUP_NOT_LOSSLESS');
    }
    const targetPath = destination(doc.ref.path, data);
    if (!households.has(targetPath.split('/')[1])) throw new Error('ORPHANED_HOUSEHOLD_SOURCE');
    return { path: doc.ref.path, updateTime: revision(doc), data, targetPath };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const targetPaths = [...new Set(deletions.flatMap(item => [item.targetPath, ...canonicalDependencies(item.targetPath)]))];
  const targets = await getPages(db, targetPaths);
  if (targets.some(doc => !doc.exists)) throw new Error('CANONICAL_TARGET_MISSING');
  const guards = [...new Map([...context, ...targets].map(doc => [doc.ref.path,
    { path: doc.ref.path, updateTime: revision(doc) }])).values()];
  const reconciliation = await inspect(db, validateCatalog);
  if (reconciliation.issues.length || reconciliation.plans.length) {
    const counts = {};
    for (const issue of reconciliation.issues) counts[issue.code] = (counts[issue.code] ?? 0) + 1;
    throw new Error(`RECONCILIATION_REQUIRED:${JSON.stringify({ mutations: reconciliation.plans.length, issues: counts })}`);
  }
  const plan = { deletions, guards, totals: reconciliation.totals };
  // Capture and reconciliation must have observed the same revisions.
  await verifyPlan(db, plan, false);
  return plan;
}

function validatePlan(plan) {
  if (!Array.isArray(plan.deletions) || !Array.isArray(plan.guards)) throw new Error('INVALID_CLEANUP_PLAN');
  const guards = new Map(plan.guards.map(item => [item.path, item.updateTime]));
  const paths = new Set();
  for (const item of plan.deletions) {
    if (paths.has(item.path)) throw new Error('DUPLICATE_DELETE_PATH');
    paths.add(item.path);
    if (destination(item.path, item.data) !== item.targetPath || !guards.get(item.targetPath)
      || canonicalDependencies(item.targetPath).some(path => !guards.get(path))
      || typeof item.updateTime !== 'string') throw new Error('INVALID_DELETE_TARGET');
  }
  for (const path of guards.keys()) if (paths.has(path)) throw new Error('CANONICAL_DELETE_FORBIDDEN');
}

async function verifyPlan(db, plan, allowDeleted) {
  validatePlan(plan);
  const expected = new Map([...plan.guards, ...plan.deletions].map(item => [item.path, item.updateTime]));
  const sourcePaths = new Set(plan.deletions.map(item => item.path));
  const current = await getPages(db, [...expected.keys()]);
  for (const doc of current) {
    if (!doc.exists && allowDeleted && sourcePaths.has(doc.ref.path)) continue;
    if (revision(doc) !== expected.get(doc.ref.path)) throw new Error('CLEANUP_SOURCE_OR_TARGET_DRIFT');
  }
}

/** Delete only the reviewed, backed-up sources; never recursively delete or write canonical data. */
export async function applyCleanup(db, plan) {
  await verifyPlan(db, plan, true);
  const guards = new Map(plan.guards.map(item => [item.path, item.updateTime]));
  let deleted = 0;
  for (let offset = 0; offset < plan.deletions.length; offset += 100) {
    const page = plan.deletions.slice(offset, offset + 100);
    deleted += await db.runTransaction(async tx => {
      const paths = [...new Set(page.flatMap(item => [item.path, item.targetPath, ...canonicalDependencies(item.targetPath)]))];
      const snapshots = new Map((await tx.getAll(...paths.map(path => db.doc(path)))).map(doc => [doc.ref.path, doc]));
      const pending = [];
      for (const item of page) {
        const source = snapshots.get(item.path);
        if (revision(snapshots.get(item.targetPath)) !== guards.get(item.targetPath)) throw new Error('CLEANUP_TARGET_DRIFT');
        for (const path of canonicalDependencies(item.targetPath)) {
          if (revision(snapshots.get(path)) !== guards.get(path)) throw new Error('CLEANUP_TARGET_DRIFT');
        }
        if (!source.exists) continue;
        if (revision(source) !== item.updateTime) throw new Error('CLEANUP_SOURCE_DRIFT');
        pending.push(item);
      }
      for (const item of pending) tx.delete(db.doc(item.path));
      return pending.length;
    });
  }
  const remaining = await getPages(db, plan.deletions.map(item => item.path));
  if (remaining.some(doc => doc.exists)) throw new Error('CLEANUP_INCOMPLETE');
  const targets = await getPages(db, [...new Set(plan.deletions.map(item => item.targetPath))]);
  if (targets.some(doc => !doc.exists)) throw new Error('CANONICAL_TARGET_MISSING');
  return { deleted, alreadyDeleted: plan.deletions.length - deleted, verifiedTargets: targets.length };
}

const argument = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
async function main() {
  const project = argument('--project');
  const file = argument('--backup-file');
  if (!project || !file) throw new Error('PROJECT_AND_PRIVATE_BACKUP_FILE_REQUIRED');
  const app = initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: project }
    : { projectId: project, credential: applicationDefault() });
  try {
    const db = getFirestore(app);
    if (!process.argv.includes('--apply')) {
      const { readCategoryCatalogDocument } = createRequire(import.meta.url)('../lib/adapters/firebase/categories/categoryCatalogDocument.js');
      const plan = encode({ project, ...await planCleanup(db, readCategoryCatalogDocument) });
      const planHash = digest(plan);
      await writeFile(file, JSON.stringify({ planHash, ...plan }), { mode: 0o600, flag: 'wx' });
      const counts = {};
      for (const item of plan.deletions) {
        const parts = item.path.split('/');
        const name = parts.length === 2 ? parts[0] : `households/*/${parts[2]}`;
        counts[name] = (counts[name] ?? 0) + 1;
      }
      console.log(JSON.stringify({ mode: 'backup-plan', planHash, deletions: plan.deletions.length, counts, status: 'MATCH' }));
    } else {
      const { planHash, ...plan } = JSON.parse(await readFile(file, 'utf8'));
      if (project !== plan.project || argument('--expected-plan-hash') !== planHash || digest(plan) !== planHash) throw new Error('BACKUP_PLAN_NOT_VERIFIED');
      console.log(JSON.stringify({ mode: 'deleted', planHash, ...await applyCleanup(db, decode(plan)) }));
    }
  } finally { await deleteApp(app); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

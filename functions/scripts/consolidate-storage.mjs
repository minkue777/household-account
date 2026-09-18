import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import { ledgerPatch, validateCanonicalLedgerDocument } from './storage-consolidation-ledger.mjs';
import { paymentConfigurationPatch, validateCanonicalPaymentDocument } from './storage-consolidation-payment.mjs';
import { validatePortfolioDocument } from './storage-consolidation-portfolio.mjs';
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const hash = value => createHash('sha256').update(stable(value)).digest('hex');
const text = (...values) => values.find(value => typeof value === 'string' && value.trim() !== '') ?? '';
const revision = snapshot => snapshot.exists ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : null;
export const encode = value => value instanceof Timestamp ? { $timestamp: [value.seconds, value.nanoseconds] }
  : Array.isArray(value) ? value.map(encode) : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encode(entry)])) : value;
export const decode = value => value !== null && typeof value === 'object' && Object.keys(value).length === 1 && Array.isArray(value.$timestamp)
  ? new Timestamp(...value.$timestamp) : Array.isArray(value) ? value.map(decode)
    : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, decode(entry)])) : value;

export function categoryCatalog(householdId, household, settings, canonical, legacy) {
  const categories = canonical.map(({ id, data }) => ({
    categoryId: text(data.categoryId, data.key, id),
    name: text(data.name, data.label), color: data.color,
    budgetInWon: data.budgetInWon ?? data.budget ?? null,
    state: data.state === 'archive-pending' ? 'archive-pending'
      : data.state === 'archived' || data.lifecycleState === 'archived' || data.isActive === false ? 'archived' : 'active',
    sortOrder: data.sortOrder ?? data.order ?? 0,
    version: data.version ?? data.aggregateVersion ?? 1,
  })).sort((a, b) => a.sortOrder - b.sortOrder || a.categoryId.localeCompare(b.categoryId));
  const byId = new Map(categories.map(item => [item.categoryId, item]));
  if (byId.size !== categories.length) throw new Error('CATEGORY_ID_COLLISION');
  const categoryAliases = {};
  for (const { id, data } of [...canonical, ...legacy]) {
    const key = text(data.categoryId, data.key, id);
    if (!byId.has(key)) throw new Error('CATEGORY_CANONICAL_MISSING');
    for (const alias of [id, data.key].filter(value => typeof value === 'string' && value !== key)) {
      if ((byId.has(alias) && alias !== key) || (categoryAliases[alias] && categoryAliases[alias] !== key)) {
        throw new Error('CATEGORY_ALIAS_COLLISION');
      }
      categoryAliases[alias] = key;
    }
    const expected = byId.get(key);
    if (text(data.name, data.label) !== expected.name || data.color !== expected.color
      || (data.budgetInWon ?? data.budget ?? null) !== expected.budgetInWon
      || (data.sortOrder ?? data.order ?? 0) !== expected.sortOrder) throw new Error('CATEGORY_SOURCE_MISMATCH');
  }
  const defaultReference = settings.defaultCategoryId ?? household.defaultCategoryKey ?? null;
  const defaultCategoryId = categoryAliases[defaultReference] ?? defaultReference;
  if (categories.length && (!defaultCategoryId || byId.get(defaultCategoryId)?.state !== 'active')) {
    throw new Error('CATEGORY_DEFAULT_UNRESOLVED');
  }
  return { schemaVersion: 1, householdId, categories, defaultCategoryId,
    catalogVersion: settings.catalogVersion ?? settings.aggregateVersion ?? 0, categoryAliases };
}

export function canonicalPatch(kind, id, legacy, canonical, context) {
  if (kind === 'asset' || kind === 'position') return validatePortfolioDocument(kind, id, legacy, canonical, context);
  if (legacy) return kind === 'ledger' ? ledgerPatch(id, legacy, canonical, context)
    : paymentConfigurationPatch(kind, id, legacy, canonical, context);
  if (kind === 'ledger') validateCanonicalLedgerDocument(id, canonical, context);
  else validateCanonicalPaymentDocument(kind, id, canonical, context);
  return {};
}

export async function inspect(database, validateCatalog) {
  const households = await database.collection('households').get();
  const plans = [];
  const issues = [];
  const totals = { households: households.size, categories: 0, ledger: 0, assets: 0, positions: 0, cards: 0, rules: 0 };
  const rows = snapshot => snapshot.docs.map(document => ({ id: document.id, data: document.data() }));
  const add = (ref, data, original, sources) => {
    if (!Object.keys(data).length) return;
    plans.push({ path: ref.path, data, before: original?.exists ? original.data() : null,
      updateTime: original ? revision(original) : null,
      sources: sources.map(source => ({ path: source.ref.path, updateTime: revision(source) })) });
  };
  for (const household of households.docs) {
    const h = household.ref;
    const [members, profiles] = await Promise.all([h.collection('members').get(), h.collection('assetOwnerProfiles').get()]);
    const memberIds = new Set(members.docs.flatMap(doc => [doc.id, doc.get('memberId')]).filter(Boolean));
    const aliases = new Map();
    for (const member of members.docs) {
      for (const alias of [member.get('displayName'), member.get('name'), member.get('uid'), member.get('principalUid')].filter(Boolean)) {
        const ids = aliases.get(alias) ?? new Set(); ids.add(member.id); aliases.set(alias, ids);
      }
    }
    const context = { householdId: h.id, memberIds,
      memberIdByAlias: new Map([...aliases].filter(([, ids]) => ids.size === 1).map(([alias, ids]) => [alias, [...ids][0]])),
      ownerProfiles: profiles.docs.map(doc => ({ ...doc.data(), profileId: doc.id })) };
    const pairs = [['ledger', 'expenses', 'ledgerTransactions'], ['asset', 'assets', 'assets'],
      ['card', 'registered_cards', 'registeredCards'], ['rule', 'merchant_rules', 'merchantRules']];
    for (const [kind, oldCollection, newCollection] of pairs) {
      const [old, current] = await Promise.all([database.collection(oldCollection).where('householdId', '==', h.id).get(), h.collection(newCollection).get()]);
      const existing = new Map(current.docs.map(document => [document.id, document]));
      const oldIds = new Set(old.docs.map(document => document.id));
      totals[{ ledger: 'ledger', asset: 'assets', card: 'cards', rule: 'rules' }[kind]] += old.size;
      for (const source of old.docs) {
        const target = existing.get(source.id);
        try {
          const patch = canonicalPatch(kind, source.id, source.data(), target?.data(), context);
          if (target && source.data().householdId !== target.data().householdId) throw new Error('TENANT_MISMATCH');
          add(h.collection(newCollection).doc(source.id), patch, target, [source, ...members.docs, ...profiles.docs]);
        } catch (error) { issues.push({ scope: kind, referenceHash: hash(source.ref.path), code: error.message }); }
      }
      for (const target of current.docs.filter(doc => !oldIds.has(doc.id))) {
        try {
          const patch = canonicalPatch(kind, target.id, undefined, target.data(), context);
          add(target.ref, patch, target, [...members.docs, ...profiles.docs]);
        } catch (error) { issues.push({ scope: kind, referenceHash: hash(target.ref.path), code: error.message }); }
      }
    }
    const [categoryRows, legacyRows, settings, current] = await Promise.all([
      h.collection('categories').get(), database.collection('categories').where('householdId', '==', h.id).get(),
      h.collection('categorySettings').doc('default').get(), h.collection('categoryCatalog').doc('current').get(),
    ]);
    totals.categories += categoryRows.size;
    try {
      // After approved source cleanup, the current catalog is the only authority.
      const canonicalOnly = categoryRows.empty && legacyRows.empty && !settings.exists && current.exists;
      const data = canonicalOnly ? current.data()
        : categoryCatalog(h.id, household.data(), settings.data() ?? {}, rows(categoryRows), rows(legacyRows));
      validateCatalog(data, h.id);
      if (Buffer.byteLength(JSON.stringify(data), 'utf8') > 800_000) throw new Error('CATEGORY_CATALOG_TOO_LARGE');
      if (!current.exists) add(current.ref, data, current, [household, settings, ...categoryRows.docs, ...legacyRows.docs]);
      else if (stable(current.data()) !== stable(data)) throw new Error('CATALOG_ALREADY_EXISTS_DIFFERENT');
    } catch (error) { issues.push({ scope: 'category', referenceHash: hash(h.path), code: error.message }); }
    const positionIds = new Set();
    const canonicalAssets = await h.collection('assets').get();
    const assetIds = new Set(canonicalAssets.docs.map(asset => asset.id));
    for (const name of ['stock_holdings', 'crypto_holdings']) {
      const old = await database.collection(name).where('householdId', '==', h.id).get();
      totals.positions += old.size;
      for (const source of old.docs) {
        const assetId = source.get('assetId');
        if (typeof assetId !== 'string' || !assetId) { issues.push({ scope: 'position', code: 'ASSET_ID_MISSING' }); continue; }
        if (!assetIds.has(assetId)) { issues.push({ scope: 'position', referenceHash: hash(source.ref.path), code: 'PARENT_ASSET_MISSING' }); continue; }
        const target = await h.collection('assets').doc(assetId).collection('positions').doc(source.id).get();
        positionIds.add(target.ref.path);
        try {
          const patch = canonicalPatch('position', source.id, source.data(), target.data(),
            { ...context, assetId, positionKind: name === 'stock_holdings' ? 'stock' : 'crypto' });
          add(target.ref, patch, target, [source]);
        }
        catch (error) { issues.push({ scope: 'position', referenceHash: hash(source.ref.path), code: error.message }); }
      }
    }
    for (const asset of canonicalAssets.docs) {
      for (const position of (await asset.ref.collection('positions').get()).docs) {
        if (positionIds.has(position.ref.path)) continue;
        try {
          const patch = canonicalPatch('position', position.id, undefined, position.data(), { ...context, assetId: asset.id });
          add(position.ref, patch, position, []);
        } catch (error) { issues.push({ scope: 'position', referenceHash: hash(position.ref.path), code: error.message }); }
      }
    }
  }
  return { totals, plans, issues };
}

/** Exact before/after comparison permits safe replay after partial completion, never an overwrite of concurrent changes. */
export async function applyPlan(db, plan) {
  const desired = item => ({ ...(item.before ?? {}), ...item.data });
  const applied = (snapshot, item) => snapshot.exists && stable(snapshot.data()) === stable(desired(item));
  const verify = (snapshot, expected) => { if (revision(snapshot) !== expected) throw new Error('SOURCE_DRIFT'); };
  const check = (stored, item) => {
    item.sources.forEach((source, index) => verify(stored[index], source.updateTime));
    const target = stored.at(-1);
    if (applied(target, item)) return true;
    verify(target, item.updateTime);
    return false;
  };
  const refs = item => [...item.sources.map(source => db.doc(source.path)), db.doc(item.path)];
  if (new Set(plan.plans.map(item => item.path)).size !== plan.plans.length) throw new Error('DUPLICATE_TARGET');
  if (plan.issues.length) throw new Error('PLAN_HAS_ISSUES');
  // Validate the entire plan before the first write, then recheck each atomic patch.
  for (const item of plan.plans) check(await db.getAll(...refs(item)), item);
  let written = 0;
  for (let offset = 0; offset < plan.plans.length; offset += 100) {
    const page = plan.plans.slice(offset, offset + 100);
    written += await db.runTransaction(async tx => {
      const pending = [];
      for (const item of page) {
        if (!check(await tx.getAll(...refs(item)), item)) pending.push(item);
      }
      for (const item of pending) {
        if (item.updateTime === null) tx.create(db.doc(item.path), item.data);
        else tx.update(db.doc(item.path), item.data);
      }
      return pending.length;
    });
  }
  for (const item of plan.plans) {
    const stored = (await db.doc(item.path).get()).data();
    for (const [key, value] of Object.entries(item.data)) {
      if (stable(stored?.[key]) !== stable(value)) throw new Error('RECONCILIATION_MISMATCH');
    }
  }
  return { written, alreadyApplied: plan.plans.length - written };
}

function argument(name) { const at = process.argv.indexOf(name); return at < 0 ? undefined : process.argv[at + 1]; }
async function main() {
  const project = argument('--project');
  const planFile = argument('--plan-file');
  if (!project || !planFile) throw new Error('PROJECT_AND_PRIVATE_PLAN_FILE_REQUIRED');
  const app = initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId: project }
    : { projectId: project, credential: applicationDefault() });
  try {
    const db = getFirestore(app);
    if (!process.argv.includes('--apply')) {
      const { readCategoryCatalogDocument } = createRequire(import.meta.url)('../lib/adapters/firebase/categories/categoryCatalogDocument.js');
      const result = await inspect(db, readCategoryCatalogDocument);
      const plan = encode({ project, ...result });
      const planHash = hash(plan);
      // Private artifact only: never print source financial contents or identifiers.
      await writeFile(planFile, JSON.stringify({ planHash, ...plan }), { mode: 0o600 });
      const issueCounts = {};
      for (const issue of result.issues) issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
      console.log(JSON.stringify({ mode: 'plan', planHash, totals: result.totals, mutations: result.plans.length, issueCounts }));
      if (result.issues.length) process.exitCode = 2;
      return;
    }
    const { planHash, ...encodedPlan } = JSON.parse(await readFile(planFile, 'utf8'));
    if (encodedPlan.project !== project || argument('--expected-plan-hash') !== planHash || hash(encodedPlan) !== planHash || encodedPlan.issues.length) {
      throw new Error('PLAN_NOT_VERIFIED');
    }
    const plan = decode(encodedPlan);
    const result = await applyPlan(db, plan);
    console.log(JSON.stringify({ mode: 'applied', planHash, ...result, status: 'MATCH' }));
  } finally { await deleteApp(app); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

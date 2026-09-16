import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

export const FIREBASE_TARGETS = [
  'functions:default', 'functions:payment-capture', 'functions:access-session',
  'firestore:rules', 'firestore:indexes', 'storage',
];
const functionTargets = FIREBASE_TARGETS.slice(0, 3);
const codebases = [['functions/', 'functions:default'], ['functions-payment-capture/', 'functions:payment-capture'], ['functions-access-session/', 'functions:access-session']];

export function firebaseTargetsForPaths(paths) {
  const targets = new Set();
  for (const path of paths) {
    if (path === 'firebase.json' || path === '.firebaserc') return [...FIREBASE_TARGETS];
    if (path === 'firestore.rules') targets.add('firestore:rules');
    if (path === 'firestore.indexes.json') targets.add('firestore:indexes');
    if (path === 'storage.rules') targets.add('storage');
    // Both child codebases copy functions/lib, including shared runtime contracts.
    if (path.startsWith('functions/src/') || path.startsWith('contracts/') || path.startsWith('tools/build/') || path === 'functions/tsconfig.json') {
      functionTargets.forEach(target => targets.add(target));
    }
    for (const [prefix, target] of codebases) {
      if (!path.startsWith(prefix)) continue;
      const local = path.slice(prefix.length);
      if (/^(?:test|scripts)\//.test(local) || /(?:^|\/)(?:README\.md|vitest[^/]*|tsconfig\.test\.json)$/.test(local)) continue;
      if (prefix === 'functions/' && local.startsWith('src/')) continue;
      targets.add(target);
    }
  }
  return FIREBASE_TARGETS.filter(target => targets.has(target));
}

export function planFirebaseDeployment({ head, previous, manifest, deployAll = false }, git = args => execFileSync('git', args, { encoding: 'utf8' }).trim()) {
  if (!/^[a-f0-9]{40}$/i.test(head)) throw new Error('DEPLOY_SCOPE_HEAD_REQUIRED');
  if (previous && !deployAll && (previous.record.status !== 'completed' || previous.record.smoke?.status !== 'passed')) throw new Error('PREVIOUS_DEPLOYMENT_NOT_SUCCESSFUL');
  const base = previous?.record.commitSha;
  if (base && !/^[a-f0-9]{40}$/i.test(base)) throw new Error('DEPLOY_SCOPE_BASE_REQUIRED');
  const targets = !base || deployAll ? [...FIREBASE_TARGETS]
    : firebaseTargetsForPaths(git(['diff', '--no-renames', '--name-only', '-z', base, head, '--']).split('\0').filter(Boolean));
  const oldMarker = previous?.scope?.queryDeployment ?? (previous && {
    releaseId: previous.record.releaseId, commitSha: base, artifactSha256: previous.record.artifact.sha256,
  });
  const queryDeployment = targets.includes('functions:default') && manifest
    ? { releaseId: manifest.releaseId, commitSha: head, artifactSha256: manifest.artifacts[0].sha256 }
    : oldMarker;
  return { baseReleaseId: previous?.record.releaseId ?? null, baseCommitSha: base ?? null, targets, ...(queryDeployment ? { queryDeployment } : {}) };
}

export async function readFirebaseDeploymentBaseline(database) {
  const snapshot = await database.collection('deploymentProvenance').orderBy('record.recordedAt', 'desc').limit(1).get();
  if (snapshot.empty) return undefined;
  const record = snapshot.docs[0].data().record;
  if (record.projectId !== 'household-account-6f300') throw new Error('DEPLOY_SCOPE_PROJECT_MISMATCH');
  const approved = (await database.collection('approvedReleases').doc(record.releaseId).get()).data();
  if (!approved || approved.release.commitSha !== record.commitSha || approved.release.manifestHash !== record.manifestHash) throw new Error('DEPLOY_SCOPE_APPROVAL_MISMATCH');
  return { record, scope: approved.evidence?.scope };
}

export function requireFirebaseDeploymentScope(approved, current, only) {
  if (!isDeepStrictEqual(approved, current) || only !== current.targets.join(',')) throw new Error('DEPLOY_SCOPE_CHANGED');
}

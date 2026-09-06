import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { androidSummary, releaseGateEvidence, requireSuccessfulHeadRun } from './release-evidence.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const arg = name => { const index = process.argv.indexOf(`--${name}`); return index < 0 ? undefined : process.argv[index + 1]; };

function run(command, args, capture = false, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', env, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`RELEASE_COMMAND_FAILED:${command}:${result.status ?? 'unavailable'}`);
  return result.stdout?.trim();
}

function npm(args) {
  const cli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(cli)) throw new Error('NPM_CLI_NOT_FOUND: npm --prefix functions run deploy를 사용하세요.');
  run(process.execPath, [cli, '--prefix', join(root, 'functions'), ...args]);
}

function treeHash(paths, workspaceRoot = root) {
  const files = paths.flatMap(path => {
    const absolute = join(workspaceRoot, path);
    if (!existsSync(absolute)) throw new Error(`RELEASE_INPUT_MISSING:${path}`);
    if (statSync(absolute).isFile()) return [path];
    return readdirSync(absolute, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile())
      .map(entry => relative(workspaceRoot, join(entry.parentPath ?? entry.path, entry.name)).replaceAll('\\', '/'));
  }).filter(path => !path.endsWith('/bootstrap/deployment-marker.json')).sort();
  return sha256(JSON.stringify(files.map(path => [path, sha256(readFileSync(join(workspaceRoot, path)))])));
}

export function currentHashes(workspaceRoot = root) {
  const hash = paths => treeHash(paths, workspaceRoot);
  return {
    artifact: { name: 'firebase-functions', sha256: hash(['functions/lib', 'functions/package.json', 'functions/package-lock.json', 'functions-payment-capture/lib', 'functions-payment-capture/index.js', 'functions-payment-capture/package.json', 'functions-payment-capture/package-lock.json', 'functions-access-session/lib', 'functions-access-session/index.js', 'functions-access-session/package.json', 'functions-access-session/package-lock.json']) },
    dependencyLockHash: hash(['functions/package-lock.json', 'functions-payment-capture/package-lock.json', 'functions-access-session/package-lock.json', 'web/package-lock.json']),
    contractHash: hash(['contracts']), rulesHash: hash(['firestore.rules', 'storage.rules']), indexesHash: hash(['firestore.indexes.json']),
  };
}

function prepareCodebases() {
  for (const name of ['functions-payment-capture', 'functions-access-session']) run(process.execPath, [join(root, 'tools/build/prepare-functions-codebase.mjs'), name]);
}

export function writeDeploymentMarker(manifest, artifact, workspaceRoot = root) {
  const marker = { releaseId: manifest.releaseId, commitSha: manifest.commitSha, artifactSha256: artifact.sha256 };
  for (const directory of ['functions/lib/bootstrap', 'functions-payment-capture/lib/core/bootstrap', 'functions-access-session/lib/core/bootstrap']) {
    mkdirSync(join(workspaceRoot, directory), { recursive: true });
    writeFileSync(join(workspaceRoot, directory, 'deployment-marker.json'), `${JSON.stringify(marker)}\n`, 'utf8');
  }
}

export function requireAuthorizedActor(manifest, actorId) {
  if (!Array.isArray(manifest.authorizedActorIds) || !manifest.authorizedActorIds.includes(actorId)) throw new Error('UNAUTHORIZED_RELEASE_ACTOR');
}

export function requireSmokeMarker(response, manifest, artifact) {
  const marker = response?.result?.deployment;
  if (marker?.releaseId !== manifest.releaseId || marker?.commitSha !== manifest.commitSha || marker?.artifactSha256 !== artifact.sha256) throw new Error('SMOKE_DEPLOYMENT_MARKER_MISMATCH');
}

export async function verifyCandidate(manifest, projectId, dependencies) {
  if (projectId !== 'household-account-6f300' || manifest.firebaseProjectId !== projectId) throw new Error('EXPLICIT_PRODUCTION_PROJECT_REQUIRED');
  if (manifest.environment !== 'production') throw new Error('PRODUCTION_ENVIRONMENT_REQUIRED');
  if (typeof manifest.contractVersion !== 'string' || !manifest.contractVersion.trim()) throw new Error('CONTRACT_VERSION_REQUIRED');
  if (!/^[A-Za-z0-9._-]+$/.test(manifest.releaseId ?? '')) throw new Error('RELEASE_ID_REQUIRED');
  if (manifest.compatibility?.releaseId !== manifest.releaseId) throw new Error('COMPATIBILITY_RELEASE_MISMATCH');
  if (dependencies.dirty || manifest.commitSha !== dependencies.head) throw new Error('CLEAN_EXACT_HEAD_REQUIRED');
  for (const key of ['dependencyLockHash', 'contractHash', 'rulesHash', 'indexesHash']) {
    if (manifest[key] !== dependencies.hashes[key]) throw new Error(`RELEASE_HASH_MISMATCH:${key}`);
  }
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length !== 1 || manifest.artifacts[0]?.name !== dependencies.hashes.artifact.name || manifest.artifacts[0]?.sha256 !== dependencies.hashes.artifact.sha256) throw new Error('ARTIFACT_MISMATCH');
  const target = await dependencies.compatibility.resolveDeploymentTarget(manifest.target);
  if (target.kind !== 'resolved' || target.target.projectId !== projectId) throw new Error('TARGET_MISMATCH');
  if ((await dependencies.compatibility.verifyCompatibilityWindow(manifest.compatibility)).kind !== 'compatible') throw new Error('INCOMPATIBLE_ORDER');
  const evaluation = await dependencies.evaluator.evaluate(manifest);
  if (evaluation.kind !== 'approved') throw new Error('RELEASE_GATES_REJECTED');
  return evaluation;
}

export async function verifyCloudResource(credential, resource, api) {
  if (!resource.startsWith('projects/household-account-6f300/')) throw new Error('CLOUD_RESOURCE_PROJECT_MISMATCH');
  const token = await credential.getAccessToken();
  const response = await fetch(`https://${api}/v3/${resource}`, { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('MONITORING_CHANNEL_UNAVAILABLE');
  const channel = await response.json();
  // Monitoring GET treats omitted/UNSPECIFIED verification as exempt, not unverified.
  // https://cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.notificationChannels
  return channel.name === resource && channel.enabled === true &&
    [undefined, 'VERIFICATION_STATUS_UNSPECIFIED', 'VERIFIED'].includes(channel.verificationStatus);
}

async function main() {
  if (process.argv.includes('--print-hashes')) {
    if (run('git', ['status', '--porcelain'], true)) throw new Error('CLEAN_EXACT_HEAD_REQUIRED');
    const candidateHead = run('git', ['rev-parse', 'HEAD'], true);
    npm(['run', 'test:quality-gate']);
    prepareCodebases();
    if (run('git', ['status', '--porcelain'], true) || run('git', ['rev-parse', 'HEAD'], true) !== candidateHead) throw new Error('CLEAN_EXACT_HEAD_REQUIRED');
    console.log(JSON.stringify({ commitSha: candidateHead, ...currentHashes() }, null, 2));
    return;
  }
  const guard = process.argv.includes('--guard');
  const projectId = arg('project') ?? (guard ? process.env.HOUSEHOLD_DEPLOY_PROJECT : undefined);
  const manifestPath = arg('manifest') ?? (guard ? process.env.HOUSEHOLD_DEPLOY_MANIFEST : undefined);
  if (!manifestPath || !projectId) throw new Error('--project와 --manifest가 필요합니다. 직접 firebase deploy 대신 npm --prefix functions run deploy -- ... 를 사용하세요.');
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('PRODUCTION_EMULATOR_MIXED');
  if (guard && process.env.GCLOUD_PROJECT !== projectId) throw new Error('FIREBASE_ACTIVE_PROJECT_MISMATCH');
  const head = run('git', ['rev-parse', 'HEAD'], true);
  const dirty = run('git', ['status', '--porcelain'], true);
  if (dirty) throw new Error('CLEAN_EXACT_HEAD_REQUIRED');
  const manifest = json(resolve(manifestPath));
  const runs = JSON.parse(run('gh', ['run', 'list', '--workflow', 'quality-gates.yml', '--commit', head, '--event', 'push', '--limit', '1', '--json', 'databaseId,headSha,status,conclusion,event'], true));
  if (!runs[0]) throw new Error('EXACT_HEAD_QUALITY_GATES_REQUIRED');
  const jobs = JSON.parse(run('gh', ['run', 'view', String(runs[0].databaseId), '--json', 'jobs'], true)).jobs;
  const ci = requireSuccessfulHeadRun(runs, head, jobs);
  // CLI hook도 독립적으로 필수 local gate를 실행합니다. 실패 시 Firebase가 배포를 취소합니다.
  npm(['run', 'test:quality-gate']);
  prepareCodebases();
  const { createReleaseCandidateEvaluationApplication } = await import('../lib/platform/delivery-assurance/application/releaseCandidateEvaluationApplication.js');
  const { createDeploymentTargetCompatibilityApplication } = await import('../lib/platform/delivery-assurance/application/deploymentTargetCompatibilityApplication.js');
  const { createDeploymentProvenanceApplication } = await import('../lib/platform/delivery-assurance/application/deploymentProvenanceApplication.js');
  const { FirebaseDeploymentProvenanceStore } = await import('../lib/adapters/firebase/operations/firebaseDeploymentProvenance.js');
  const temporary = mkdtempSync(join(tmpdir(), 'household-release-'));
  for (const name of ['functions', 'web', 'android']) run('gh', ['run', 'download', String(ci.databaseId), '--name', `quality-${name}`, '--dir', join(temporary, name)]);
  const evidence = releaseGateEvidence(json(join(temporary, 'functions/quality-functions.json')), json(join(temporary, 'web/quality-web.json')), androidSummary(join(temporary, 'android')));
  const hashes = currentHashes();
  const evaluator = createReleaseCandidateEvaluationApplication({ evidence: { collect: async () => evidence }, manifestHash: { hash: value => sha256(JSON.stringify(value)) } });
  const evaluation = await verifyCandidate(manifest, projectId, { dirty: run('git', ['status', '--porcelain'], true), head: run('git', ['rev-parse', 'HEAD'], true), hashes, evaluator, compatibility: createDeploymentTargetCompatibilityApplication() });
  const actorId = JSON.parse(run('gh', ['api', 'user'], true)).login;
  requireAuthorizedActor(manifest, actorId);
  writeDeploymentMarker(manifest, hashes.artifact);
  const credential = applicationDefault();
  if (!await verifyCloudResource(credential, manifest.monitoringChannelReference, 'monitoring.googleapis.com')) throw new Error('MONITORING_CHANNEL_UNVERIFIED');
  if (!Array.isArray(manifest.secretReferences) || manifest.secretReferences.length === 0) throw new Error('SECRET_BINDINGS_REQUIRED');
  if (!manifest.secretReferences.some(reference => /^projects\/household-account-6f300\/secrets\/SHORTCUT_CREDENTIAL_PEPPER\/versions\/(latest|[0-9]+)$/.test(reference))) throw new Error('SHORTCUT_SECRET_BINDING_REQUIRED');
  for (const reference of manifest.secretReferences) {
    if (!/^projects\/household-account-6f300\/secrets\/[A-Za-z0-9_-]+\/versions\/(latest|[0-9]+)$/.test(reference)) throw new Error('SECRET_PROJECT_MISMATCH');
    const token = await credential.getAccessToken();
    const response = await fetch(`https://secretmanager.googleapis.com/v1/${reference}`, { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(15000) });
    if (!response.ok || (await response.json()).state !== 'ENABLED') throw new Error('SECRET_VERSION_UNAVAILABLE');
  }
  if (!guard && process.argv.includes('--check')) { console.log(JSON.stringify({ kind: 'approved', commitSha: head, runId: ci.databaseId })); return; }
  const app = initializeApp({ projectId, credential });
  const store = new FirebaseDeploymentProvenanceStore(getFirestore(app));
  if (guard) {
    await store.requireDeploymentLease(projectId, process.env.HOUSEHOLD_DEPLOY_LEASE, manifest.releaseId);
    console.log(JSON.stringify({ kind: 'approved', commitSha: head, runId: ci.databaseId }));
    return;
  }
  const smokeToken = arg('smoke-token-file');
  if (!smokeToken || !existsSync(smokeToken)) throw new Error('SMOKE_TOKEN_FILE_REQUIRED');
  const release = { releaseId: manifest.releaseId, manifestHash: evaluation.deployAuthorization.manifestHash,
    commitSha: head, ...hashes, projectId, authorizedActorIds: manifest.authorizedActorIds };
  await store.approve(release, { ciRunId: ci.databaseId, gateResults: evidence, compatibility: manifest.compatibility });
  const require = createRequire(join(root, 'web/package.json'));
  const firebase = require.resolve('firebase-tools/lib/bin/firebase.js');
  const leaseOwner = randomUUID();
  await store.acquireDeploymentLease(projectId, leaseOwner, manifest.releaseId);
  let failure;
  try {
    run(process.execPath, [firebase, 'deploy', '--project', projectId, '--config', join(root, 'firebase.json'), '--only', 'functions,firestore,storage'], false,
      { ...process.env, HOUSEHOLD_DEPLOY_PROJECT: projectId, HOUSEHOLD_DEPLOY_MANIFEST: resolve(manifestPath), HOUSEHOLD_DEPLOY_LEASE: leaseOwner });
    if (JSON.stringify(currentHashes()) !== JSON.stringify(hashes)) throw new Error('DEPLOYED_ARTIFACT_CHANGED');
    const token = readFileSync(smokeToken, 'utf8').trim();
    const response = await fetch(`https://asia-northeast3-${projectId}.cloudfunctions.net/executeHouseholdCommand`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ data: { contractVersion: 'household-command.v1', command: 'access.resolve-signed-in-user.v1', commandId: `smoke-${manifest.releaseId}`, idempotencyKey: `smoke-${manifest.releaseId}`, payload: {} } }),
    });
    const body = await response.json();
    if (!response.ok || body.result?.result?.kind !== 'succeeded') throw new Error('SMOKE_FAILED');
    const resolved = body.result.result.value;
    if (resolved?.kind !== 'membership-found' || !resolved.membership?.householdId) throw new Error('SMOKE_ACTIVE_MEMBERSHIP_REQUIRED');
    const readResponse = await fetch(`https://asia-northeast3-${projectId}.cloudfunctions.net/executeHouseholdQuery`, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ data: { contractVersion: 'household-query.v1', query: 'access.list-asset-owner-profiles.v1', queryId: `smoke-${manifest.releaseId}`, householdId: resolved.membership.householdId, payload: {} } }),
    });
    const readBody = await readResponse.json();
    if (!readResponse.ok || readBody.result?.result?.kind !== 'succeeded') throw new Error('SMOKE_HOUSEHOLD_READ_FAILED');
    requireSmokeMarker(readBody, manifest, hashes.artifact);
  } catch (error) { failure = error; }
  const provenance = createDeploymentProvenanceApplication({ releases: store, records: store.records,
    channels: { isVerified: reference => verifyCloudResource(credential, reference, 'monitoring.googleapis.com') },
    identity: { deploymentId: id => sha256(id), fingerprint: value => sha256(JSON.stringify(value)) }, clock: { now: () => new Date().toISOString() } });
  const recorded = await provenance.recordDeploymentResult(manifest.releaseId, { manifestHash: release.manifestHash, projectId, actorId, artifact: hashes.artifact,
    smoke: failure ? { status: 'failed', artifactSha256: hashes.artifact.sha256, code: 'SMOKE_FAILED' } : { status: 'passed', artifactSha256: hashes.artifact.sha256 },
    monitoringChannelReference: manifest.monitoringChannelReference, adapterDiagnostics: failure ? [{ code: 'DEPLOYMENT_OR_SMOKE_FAILED' }] : [],
    ...(manifest.rollback ? { rollback: manifest.rollback } : {}) });
  if (recorded.kind === 'rejected') throw new Error(`PROVENANCE_REJECTED:${recorded.code}`);
  if (failure) throw failure;
  await store.releaseDeploymentLease(projectId, leaseOwner);
  console.log(JSON.stringify({ kind: recorded.kind, releaseId: manifest.releaseId }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });

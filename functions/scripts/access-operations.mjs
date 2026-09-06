import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { createFirebaseHouseholdPurgeRuntime } from '../lib/bootstrap/operations/householdPurgeRuntime.js';
import { repairFirebaseLegacyMembership, reconcileFirebaseHouseholdClaimLifecycle } from '../lib/bootstrap/operations/accessRecoveryRuntime.js';

function arg(name, required = true) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (required && (!value || value.startsWith('--'))) throw new Error(`--${name} 값이 필요합니다.`);
  return value;
}

async function main() {
  const projectId = arg('project');
  const householdId = arg('household');
  const operation = arg('operation');
  if (arg('confirm-household') !== householdId) throw new Error('확인한 가구 ID가 다릅니다.');
  if (!/^[A-Za-z0-9._:-]+$/.test(householdId)) throw new Error('유효하지 않은 가구 ID입니다.');
  if (projectId !== 'household-account-6f300' && !projectId.startsWith('demo-')) throw new Error('등록된 운영/Emulator 프로젝트만 허용합니다.');
  if (projectId.startsWith('demo-') && !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('테스트 프로젝트에는 Emulator가 필요합니다.');
  if (!projectId.startsWith('demo-') && (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)) throw new Error('운영과 Emulator 설정이 섞였습니다.');
  const app = initializeApp({ projectId, ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: applicationDefault() }) });
  const token = (await readFile(arg('operator-token-file'), 'utf8')).trim();
  const operator = await getAuth(app).verifyIdToken(token, true);
  if (operator.systemAdmin !== true) throw new Error('시스템 관리자 인증이 필요합니다.');
  const db = getFirestore(app);
  if (operation === 'repair-membership') {
    const result = await repairFirebaseLegacyMembership(db, {
      householdId, operatorRef: operator.uid, principalUid: arg('principal'), memberId: arg('member'),
      reason: arg('reason'), idempotencyKey: arg('request-id'),
    });
    console.log(JSON.stringify({ kind: result.kind, ...('code' in result ? { code: result.code } : {}) }));
    return;
  }
  if (operation === 'repair-claim-lifecycle') {
    console.log(JSON.stringify(await reconcileFirebaseHouseholdClaimLifecycle(db, {
      householdId, operatorRef: operator.uid, reason: arg('reason'), after: arg('after', false),
    })));
    return;
  }
  if (operator.householdPurgePermanent !== true) throw new Error('별도 householdPurgePermanent 권한이 필요합니다.');
  const runtime = createFirebaseHouseholdPurgeRuntime(db, { householdId, operatorRef: operator.uid, idempotencyKey: arg('request-id') });
  if (operation === 'purge-request') {
    console.log(JSON.stringify(await runtime.application.requestPermanentHouseholdPurge(
      { principalRef: operator.uid, capabilities: ['household.purge.permanent'] },
      { householdId, confirmation: arg('confirmation'), expectedVersion: Number(arg('expected-version')), idempotencyKey: arg('request-id') },
    )));
  } else if (operation === 'purge-step') {
    console.log(JSON.stringify(await runtime.application.runHouseholdPurgeProcess(
      { systemRef: 'access-operations-cli', capabilities: ['householdLifecycle:purge'] }, runtime.processId,
    )));
  } else if (operation === 'purge-status') {
    const status = await runtime.application.getHouseholdPurgeStatus(
      { principalRef: operator.uid, capabilities: ['household.purge.read'] }, runtime.processId,
    );
    const persisted = (await db.collection('householdPurgeProcesses').doc(runtime.processId).get()).data();
    console.log(JSON.stringify({ ...status, ...(status.kind === 'Success' ? {
      checkpoints: persisted?.process?.participants,
      lease: persisted?.leaseToken ? { token: persisted.leaseToken, startedAt: persisted.leaseStartedAt?.toDate?.().toISOString() } : null,
    } : {}) }));
  } else if (operation === 'purge-unlock') {
    const expectedToken = arg('stopped-lease-token');
    const reason = arg('reason');
    if (!reason.trim()) throw new Error('복구 사유가 필요합니다.');
    const ref = db.collection('householdPurgeProcesses').doc(runtime.processId);
    await db.runTransaction(async tx => {
      const data = (await tx.get(ref)).data();
      if (data?.householdId !== householdId || data.leaseToken !== expectedToken) throw new Error('중단된 lease가 현재 상태와 다릅니다.');
      tx.update(ref, { leaseToken: FieldValue.delete(), leaseStartedAt: FieldValue.delete() });
      tx.create(ref.collection('leaseRecoveryAudit').doc(), { operatorRef: operator.uid, reasonHash: createHash('sha256').update(reason.trim()).digest('hex'), recoveredAt: FieldValue.serverTimestamp() });
    });
    console.log(JSON.stringify({ kind: 'unlocked' }));
  } else throw new Error('지원하지 않는 operation입니다.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { expect, type APIRequestContext } from '@playwright/test';
import { firestoreFields, type FirestoreDocument } from './emulator';

// 이 파일의 모든 DB 요청은 별도 demo 프로젝트의 로컬 Emulator만 사용합니다.
export const OPERATIONS_PROJECT_ID = 'demo-household-operations-e2e';
export const OPERATIONS_HOUSEHOLD_ID = 'operations-household-a';
export const OPERATIONS_OTHER_HOUSEHOLD_ID = 'operations-household-b';
const root = resolve(__dirname, '../..');
const firestoreOrigin = 'http://127.0.0.1:8080';
const documentOrigin = `${firestoreOrigin}/v1/projects/${OPERATIONS_PROJECT_ID}/databases/(default)/documents`;

export interface CliResult { code: number; stdout: string; stderr: string }
export interface MigrationResult {
  kind: string; code?: string; planHash: string; checkpoint: string;
  candidateCount: number; unresolvedCount?: number; unresolved?: { code: string }[];
  appliedPages?: number; replayedPages?: number; remainingCandidates?: number;
  reconciliation?: { status: string; actualTarget: unknown; expectedTarget: unknown };
}

function cliEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', GCLOUD_PROJECT: OPERATIONS_PROJECT_ID, GOOGLE_CLOUD_PROJECT: OPERATIONS_PROJECT_ID };
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN', 'GOOGLE_OAUTH_ACCESS_TOKEN', 'HOUSEHOLD_DEPLOY_PROJECT', 'HOUSEHOLD_DEPLOY_MANIFEST', 'HOUSEHOLD_DEPLOY_LEASE']) delete environment[key as keyof typeof environment];
  return environment;
}

/** subprocess의 공개 argv를 사용합니다. Application/Repository/FS/네트워크 응답을 대체하지 않습니다. */
export async function runOperationsCli(script: 'migrate-runtime.mjs' | 'deploy-firebase.mjs', args: string[]): Promise<CliResult> {
  return new Promise((resolveResult, reject) => {
    execFile(process.execPath, [resolve(root, 'functions/scripts', script), ...args], {
      cwd: root, env: cliEnvironment(), windowsHide: true, timeout: 45_000, maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error && (error.killed || typeof error.code !== 'number')) { reject(error); return; }
      resolveResult({ code: typeof error?.code === 'number' ? error.code : 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export async function migrationCli(mode: 'dry-run' | 'apply', migrationId: string, options: Record<string, string | number>, householdId = OPERATIONS_HOUSEHOLD_ID): Promise<CliResult & { result: MigrationResult }> {
  const args = ['--mode', mode, '--project', OPERATIONS_PROJECT_ID, '--household', householdId, '--migration-id', migrationId,
    '--migration-kind', 'legacy-runtime-to-household-canonical-v1', '--schema-scope', 'legacy-flat-v1:household-canonical-v1', '--operator', 'cli-e2e-operator', '--at', '2026-09-11T00:00:00.000Z'];
  for (const [key, value] of Object.entries(options)) args.push(`--${key}`, String(value));
  const output = await runOperationsCli('migrate-runtime.mjs', args);
  const structuredOutput = output.stdout || output.stderr.split('\n').find(line => line.startsWith('{'));
  if (!structuredOutput) throw new Error(`migration CLI JSON 응답 없음: ${output.stderr}`);
  return { ...output, result: JSON.parse(structuredOutput) as MigrationResult };
}

export async function writeMigrationMapping(path: string, changes: Record<string, unknown> = {}): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ version: 1, householdIdHash: createHash('sha256').update(OPERATIONS_HOUSEHOLD_ID).digest('hex'), ...changes }), 'utf8');
}

export async function resetOperationsEmulator(request: APIRequestContext): Promise<void> {
  const response = await request.delete(`${firestoreOrigin}/emulator/v1/projects/${OPERATIONS_PROJECT_ID}/databases/(default)/documents`);
  expect(response.ok(), await response.text()).toBe(true);
}

export async function writeOperationsDocument(request: APIRequestContext, path: string, data: Record<string, unknown>): Promise<void> {
  const response = await request.patch(`${documentOrigin}/${path}`, { headers: { authorization: 'Bearer owner' }, data: { fields: firestoreFields(data) } });
  expect(response.ok(), await response.text()).toBe(true);
}

export async function readOperationsDocument(request: APIRequestContext, path: string): Promise<FirestoreDocument | undefined> {
  const response = await request.get(`${documentOrigin}/${path}`, { headers: { authorization: 'Bearer owner' } });
  if (response.status() === 404) return undefined;
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

export async function listOperationsDocuments(request: APIRequestContext, collection: string): Promise<FirestoreDocument[]> {
  const response = await request.get(`${documentOrigin}/${collection}?pageSize=1000`, { headers: { authorization: 'Bearer owner' } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).documents ?? [];
}

export async function seedMigrationLedger(request: APIRequestContext): Promise<void> {
  await Promise.all([
    writeOperationsDocument(request, `households/${OPERATIONS_HOUSEHOLD_ID}`, { lifecycleState: 'active' }),
    writeOperationsDocument(request, `households/${OPERATIONS_OTHER_HOUSEHOLD_ID}`, { lifecycleState: 'active' }),
    writeOperationsDocument(request, `households/${OPERATIONS_HOUSEHOLD_ID}/members/member-a`, { memberId: 'member-a', displayName: '이관 사용자', lifecycleState: 'active' }),
    ...[3000, 4500, 5500].map((amount, index) => writeOperationsDocument(request, `expenses/legacy-${index + 1}`, {
      householdId: OPERATIONS_HOUSEHOLD_ID, merchant: `CLI 보존 거래 ${index + 1}`, amount, category: 'etc', date: '2020-02-13', createdBy: 'member-a', memo: '출력되면 안 되는 원문 메모', schemaVersion: 1,
    })),
    writeOperationsDocument(request, 'expenses/outside-household', { householdId: OPERATIONS_OTHER_HOUSEHOLD_ID, merchant: '다른 가구 거래', amount: 99000, category: 'etc', date: '2020-02-13', createdBy: 'outside-member' }),
    writeOperationsDocument(request, 'expenses/missing-household', { merchant: '소속 미지정 거래', amount: 88000, category: 'etc', date: '2020-02-13' }),
  ]);
}

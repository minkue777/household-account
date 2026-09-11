import { expect, test } from '@playwright/test';
import {
  listOperationsDocuments, migrationCli, OPERATIONS_HOUSEHOLD_ID, OPERATIONS_OTHER_HOUSEHOLD_ID,
  readOperationsDocument, resetOperationsEmulator, runOperationsCli, seedMigrationLedger, writeMigrationMapping, writeOperationsDocument,
} from './operations-cli-helpers';
import { documentId, integerField, textField } from './finance-helpers';

test.beforeEach(async ({ request }) => { await resetOperationsEmulator(request); });

test('[T-SYS-009][SYS-009] 공개 migration CLI의 dry-run·명시 승인·page 중단과 재개는 범위를 보존하고 멱등 완료한다', async ({ request }, testInfo) => {
  await seedMigrationLedger(request);
  const mapping = testInfo.outputPath('approved-mapping.json');
  await writeMigrationMapping(mapping);
  const source = await listOperationsDocuments(request, 'expenses');
  const dry = await migrationCli('dry-run', 'cli-pages', { mapping });
  expect(dry.code, dry.stderr).toBe(0);
  expect(dry.result).toMatchObject({ kind: 'dry-run', unresolvedCount: 0, checkpoint: `${dry.result.planHash}:0` });
  expect(dry.result.candidateCount).toBeGreaterThan(3);
  expect(dry.stdout).not.toContain('출력되면 안 되는 원문 메모');
  expect(dry.stdout).not.toContain('CLI 보존 거래');
  expect(await listOperationsDocuments(request, `households/${OPERATIONS_HOUSEHOLD_ID}/ledgerTransactions`)).toHaveLength(0);
  expect(await listOperationsDocuments(request, 'expenses')).toEqual(source);
  const repeated = await migrationCli('dry-run', 'cli-pages', { mapping });
  expect(repeated.result.planHash).toBe(dry.result.planHash);
  expect(await listOperationsDocuments(request, 'operationsMigrationPlans')).toHaveLength(1);
  const unapproved = await migrationCli('apply', 'cli-pages', { 'plan-hash': dry.result.planHash });
  expect(unapproved.code).toBe(2);
  expect(unapproved.result).toMatchObject({ kind: 'blocked', code: 'EXPLICIT_CONFIRMATION_REQUIRED' });
  expect(await listOperationsDocuments(request, `households/${OPERATIONS_HOUSEHOLD_ID}/ledgerTransactions`)).toHaveLength(0);
  const first = await migrationCli('apply', 'cli-pages', { 'plan-hash': dry.result.planHash, confirm: 'APPLY', checkpoint: dry.result.checkpoint, 'page-size': 2, 'max-pages': 1 });
  expect(first.code, first.stderr).toBe(0);
  expect(first.result).toMatchObject({ kind: 'checkpoint', appliedPages: 1, checkpoint: `${dry.result.planHash}:2` });
  const candidates = (await listOperationsDocuments(request, `operationsMigrationPlans/${dry.result.planHash}/candidates`)).sort((left, right) => integerField(left, 'index') - integerField(right, 'index'));
  expect(await readOperationsDocument(request, textField(candidates[0], 'targetPath')!)).toBeDefined();
  expect(await readOperationsDocument(request, textField(candidates[1], 'targetPath')!)).toBeDefined();
  expect(await readOperationsDocument(request, textField(candidates[2], 'targetPath')!)).toBeUndefined();
  const completed = await migrationCli('apply', 'cli-pages', { 'plan-hash': dry.result.planHash, confirm: 'APPLY', checkpoint: first.result.checkpoint, 'page-size': 2 });
  expect(completed.code, completed.stderr).toBe(0);
  expect(completed.result).toMatchObject({ kind: 'applied', reconciliation: { status: 'MATCH' } });
  expect(completed.result.reconciliation?.actualTarget).toEqual(completed.result.reconciliation?.expectedTarget);
  const canonical = await listOperationsDocuments(request, `households/${OPERATIONS_HOUSEHOLD_ID}/ledgerTransactions`);
  expect(canonical.map(documentId).sort()).toEqual(['legacy-1', 'legacy-2', 'legacy-3']);
  expect(canonical.reduce((sum, doc) => sum + integerField(doc, 'amountInWon'), 0)).toBe(13000);
  expect(canonical.every(doc => textField(doc, 'creatorMemberId') === 'member-a' && textField(doc, 'memo') === '출력되면 안 되는 원문 메모')).toBe(true);
  expect(await listOperationsDocuments(request, 'expenses')).toEqual(source);
  expect(await listOperationsDocuments(request, `households/${OPERATIONS_OTHER_HOUSEHOLD_ID}/ledgerTransactions`)).toHaveLength(0);
  const receipts = await listOperationsDocuments(request, 'operationsMigrationPageReceipts');
  const replay = await migrationCli('apply', 'cli-pages', { 'plan-hash': dry.result.planHash, confirm: 'APPLY', checkpoint: completed.result.checkpoint });
  expect(replay.code).toBe(0);
  expect(replay.result).toMatchObject({ kind: 'applied', appliedPages: 0, reconciliation: { status: 'MATCH' } });
  expect(await listOperationsDocuments(request, 'operationsMigrationPageReceipts')).toEqual(receipts);
  expect(await listOperationsDocuments(request, `households/${OPERATIONS_HOUSEHOLD_ID}/ledgerTransactions`)).toEqual(canonical);
});

test('[SYS-009] CLI의 잘못된 mapping·scope·plan·checkpoint는 canonical 쓰기 없이 거절한다', async ({ request }, testInfo) => {
  await seedMigrationLedger(request);
  const mapping = testInfo.outputPath('mapping.json');
  await writeMigrationMapping(mapping);
  const invalidMapping = testInfo.outputPath('invalid-mapping.json');
  await writeMigrationMapping(invalidMapping, { householdIdHash: '0'.repeat(64) });
  const wrongMapping = await migrationCli('dry-run', 'cli-guards', { mapping: invalidMapping });
  expect(wrongMapping.code).toBe(1);
  expect(wrongMapping.result.code).toBe('MIGRATION_MAPPING_HOUSEHOLD_SCOPE_MISMATCH');
  const dry = await migrationCli('dry-run', 'cli-guards', { mapping });
  for (const [options, household, expected] of [
    [{ 'plan-hash': 'f'.repeat(64), confirm: 'APPLY' }, OPERATIONS_HOUSEHOLD_ID, 'MIGRATION_PLAN_NOT_FOUND'],
    [{ 'plan-hash': dry.result.planHash, confirm: 'APPLY' }, OPERATIONS_OTHER_HOUSEHOLD_ID, 'MIGRATION_SCOPE_MISMATCH'],
    [{ 'plan-hash': dry.result.planHash, confirm: 'APPLY', checkpoint: `${dry.result.planHash}:999` }, OPERATIONS_HOUSEHOLD_ID, 'MIGRATION_CHECKPOINT_MISMATCH'],
  ] as const) {
    const result = await migrationCli('apply', 'cli-guards', options, household);
    expect(result.code).toBe(2);
    expect(result.result).toMatchObject({ kind: 'blocked', code: expected });
  }
  expect(await listOperationsDocuments(request, `households/${OPERATIONS_HOUSEHOLD_ID}/ledgerTransactions`)).toHaveLength(0);
  expect(await listOperationsDocuments(request, 'operationsMigrationPageReceipts')).toHaveLength(0);
});

test('[SYS-009] CLI는 dry-run 뒤 원본 변경을 page 전체 rollback으로 차단하고 미해결 creator를 추정하지 않는다', async ({ request }, testInfo) => {
  await seedMigrationLedger(request);
  const mapping = testInfo.outputPath('mapping.json');
  await writeMigrationMapping(mapping);
  const dry = await migrationCli('dry-run', 'cli-source-drift', { mapping });
  await writeOperationsDocument(request, 'expenses/legacy-1', { householdId: OPERATIONS_HOUSEHOLD_ID, merchant: '변경된 원본', amount: 9900, category: 'etc', date: '2020-02-13', createdBy: 'member-a' });
  const drift = await migrationCli('apply', 'cli-source-drift', { 'plan-hash': dry.result.planHash, confirm: 'APPLY' });
  expect(drift.code).toBe(2);
  expect(drift.result.code).toBe('MIGRATION_SOURCE_CHANGED');
  expect(await listOperationsDocuments(request, `households/${OPERATIONS_HOUSEHOLD_ID}/ledgerTransactions`)).toHaveLength(0);
  expect(await listOperationsDocuments(request, `households/${OPERATIONS_HOUSEHOLD_ID}/homePreferences`)).toHaveLength(0);
  expect(await listOperationsDocuments(request, 'operationsMigrationPageReceipts')).toHaveLength(0);
  await writeOperationsDocument(request, 'expenses/unknown-creator', { householdId: OPERATIONS_HOUSEHOLD_ID, merchant: '누군지 모르는 거래', amount: 123, category: 'etc', date: '2020-02-13' });
  const unresolved = await migrationCli('dry-run', 'cli-unresolved', { mapping });
  expect(unresolved.code).toBe(0);
  expect(unresolved.result.unresolved).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'LEDGER_CREATOR_MAPPING_REQUIRED' })]));
  const blocked = await migrationCli('apply', 'cli-unresolved', { 'plan-hash': unresolved.result.planHash, confirm: 'APPLY' });
  expect(blocked.code).toBe(2);
  expect(blocked.result.code).toBe('MIGRATION_UNRESOLVED_REFERENCES');
  expect(await listOperationsDocuments(request, `households/${OPERATIONS_HOUSEHOLD_ID}/ledgerTransactions`)).toHaveLength(0);
});

test('[SYS-009] CLI apply 이후 reconciliation이 달라지면 성공으로 표시하거나 변경된 대상 값을 덮어쓰지 않는다', async ({ request }, testInfo) => {
  await seedMigrationLedger(request);
  const mapping = testInfo.outputPath('mapping.json');
  await writeMigrationMapping(mapping);
  const dry = await migrationCli('dry-run', 'cli-reconciliation', { mapping });
  const first = await migrationCli('apply', 'cli-reconciliation', { 'plan-hash': dry.result.planHash, confirm: 'APPLY' });
  expect(first.code).toBe(0);
  const targetPath = `households/${OPERATIONS_HOUSEHOLD_ID}/ledgerTransactions/legacy-1`;
  await writeOperationsDocument(request, targetPath, { householdId: OPERATIONS_HOUSEHOLD_ID, transactionId: 'legacy-1', amountInWon: 777, creatorMemberId: 'member-a' });
  const checked = await migrationCli('apply', 'cli-reconciliation', { 'plan-hash': dry.result.planHash, confirm: 'APPLY', checkpoint: first.result.checkpoint });
  expect(checked.code).toBe(2);
  expect(checked.result.code).toBe('MIGRATION_RECONCILIATION_MISMATCH');
  expect(integerField((await readOperationsDocument(request, targetPath))!, 'amountInWon')).toBe(777);
});

test('[REL-002] 실제 배포 CLI는 명시적 인자 누락과 production·Emulator 혼합을 클라우드 접근 전에 차단한다', async ({}, testInfo) => {
  const noArguments = await runOperationsCli('deploy-firebase.mjs', []);
  expect(noArguments.code).toBe(1);
  expect(noArguments.stderr).toContain('--project와 --manifest가 필요합니다.');
  const mixed = await runOperationsCli('deploy-firebase.mjs', ['--project', 'household-account-6f300', '--manifest', testInfo.outputPath('must-not-read.json'), '--check']);
  expect(mixed.code).toBe(1);
  expect(mixed.stderr).toContain('PRODUCTION_EMULATOR_MIXED');
  const guard = await runOperationsCli('deploy-firebase.mjs', ['--guard', '--project', 'household-account-6f300', '--manifest', testInfo.outputPath('must-not-read.json')]);
  expect(guard.code).toBe(1);
  expect(guard.stderr).toContain('PRODUCTION_EMULATOR_MIXED');
  expect(mixed.stdout).toBe('');
  expect(guard.stdout).toBe('');
});

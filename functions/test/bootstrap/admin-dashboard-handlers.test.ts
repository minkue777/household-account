import type * as firestore from 'firebase-admin/firestore';
import { afterEach, expect, it, vi } from 'vitest';
import { FirebaseAdminDashboardReader } from '../../src/adapters/firebase/admin/firebaseAdminDashboardReader';
import { createAdminDashboardAccessHandlers } from '../../src/bootstrap/admin/handlers/adminDashboardAccessHandlers';
import { createAdminAccessRouter, type AdminAccessOperation } from '../../src/bootstrap/admin/adminAccess';
import { verifiedSystemAdministrator } from '../../src/bootstrap/verifiedSystemAdministrator';

vi.mock('../../src/adapters/google-cloud/admin/googleCloudInteractiveLatencyReader', () => ({
  createGoogleCloudInteractiveLatencyReader: () => undefined,
}));
afterEach(() => vi.restoreAllMocks());

function execute(operation: AdminAccessOperation, payload: Record<string, unknown>, admin = true) {
  const router = createAdminAccessRouter({ handlers: new Map(createAdminDashboardAccessHandlers({} as firestore.Firestore)) });
  return router.execute({
    principalUid: 'operator',
    administrator: verifiedSystemAdministrator('operator', { systemAdmin: admin }),
    requestedAt: '2026-11-08T08:00:00Z',
    request: { contractVersion: 'admin-access.v1', requestId: 'dashboard-read', idempotencyKey: 'dashboard-read', operation, payload },
  });
}

it.each(['get-dashboard-overview', 'get-function-latency'] as const)('[T-ADM-004] %s rejects non-admins before data access', async operation => {
  const overview = vi.spyOn(FirebaseAdminDashboardReader.prototype, 'readOverview');
  const latency = vi.spyOn(FirebaseAdminDashboardReader.prototype, 'readFunctionLatency');
  expect(await execute(operation, {}, false)).toMatchObject({ kind: 'error', code: 'ADMIN_CAPABILITY_REQUIRED' });
  expect(overview).not.toHaveBeenCalled();
  expect(latency).not.toHaveBeenCalled();
});

it.each([6, 31, 7.5, '14'])('[T-ADM-004] overview rejects invalid range %s', async rangeDays => {
  expect(await execute('get-dashboard-overview', { rangeDays })).toMatchObject({ kind: 'error', code: 'INVALID_PAYLOAD' });
});

it('[T-ADM-004] latency uses a fixed window and rejects payload extensions', async () => {
  expect(await execute('get-function-latency', { windowHours: 48 })).toMatchObject({ kind: 'error', code: 'INVALID_PAYLOAD' });
  expect(await execute('get-function-latency', {})).toMatchObject({
    kind: 'success', data: { status: 'unavailable', windowHours: 24, operations: [] },
  });
});

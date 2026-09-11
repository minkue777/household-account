import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { callEmulatorFunction, createEmulatorAccount, E2E_PROJECT_ID, executeHouseholdCommand, firestoreFields, writeFirestoreFixture } from './emulator';
import { openExpenseEdit } from './finance-helpers';
import { paymentCommand, records, type PaymentActor } from './payment-helpers';

export const endpointId = (fid: string) => createHash('sha256').update(fid).digest('hex');
/** Mint Native membership claims through the deployed callable, then let Auth Emulator
 * exchange its real custom token. No claims are inserted directly into an ID token. */
export async function nativeCaptureActor(request: APIRequestContext, actor: PaymentActor): Promise<PaymentActor> {
  if (E2E_PROJECT_ID !== 'demo-household-account-e2e') throw new Error('LOCAL_DEMO_REQUIRED');
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const appCheck = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: '1:123456789:android:e2e', aud: [E2E_PROJECT_ID], exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;
  const issuance = await request.post(`http://127.0.0.1:5001/${E2E_PROJECT_ID}/asia-northeast3/createWebViewSessionToken`, {
    headers: { authorization: `Bearer ${actor.idToken}`, 'X-Firebase-AppCheck': appCheck }, data: { data: {} },
  });
  expect(issuance.ok()).toBe(true);
  const wire = (await issuance.json()).result;
  expect(wire.contractVersion).toBe('webview-session-token.v1');
  const exchange = await request.post('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-api-key', {
    data: { token: wire.nativeCustomToken, returnSecureToken: true },
  });
  expect(exchange.ok()).toBe(true);
  const signedIn = await exchange.json();
  const claims = JSON.parse(Buffer.from(signedIn.idToken.split('.')[1], 'base64url').toString());
  expect(claims).toMatchObject({ sub: actor.uid, hcaClient: 'native', hcaCaptureMember: true,
    hcaCaptureHouseholdId: actor.householdId, hcaCaptureMemberId: actor.memberId });
  return { ...actor, idToken: signedIn.idToken, refreshToken: signedIn.refreshToken };
}
export async function joinNotificationHousehold(request: APIRequestContext, inviter: PaymentActor, name: string): Promise<PaymentActor> {
  const account = await createEmulatorAccount(request, `${name}@household.test`);
  const invitation = await paymentCommand(request, inviter, 'access.create-invitation.v1', {});
  const membership = await executeHouseholdCommand<{ householdId: string; memberId: string }>(request, {
    idToken: account.idToken, command: 'access.join-household-as-self.v1', payload: { invitationCode: invitation.invitationCode, memberName: name },
  });
  return { ...account, ...membership };
}
export async function registerEndpoint(request: APIRequestContext, actor: PaymentActor, fid: string, platform: 'android' | 'ios-pwa' = 'android') {
  const result = await paymentCommand(request, actor, 'notifications.register-endpoint.v1', { fid, platform, deviceInfo: { model: 'E2E synthetic installation', appVersion: '1.0' } });
  expect(result.kind).toBe('registered');
  expect(result.endpointId).toBe(endpointId(fid));
  return result;
}
export async function waitForOutbox(request: APIRequestContext, transactionId: string, eventType: string, excludedIds: string[] = []) {
  let result: Record<string, any> | undefined;
  await expect.poll(async () => {
    result = (await records(request, 'outboxEvents')).find(row => row.eventType === eventType && (row.payload?.transactionId === transactionId || row.aggregateId === transactionId) && !excludedIds.includes(row.id));
    return Boolean(result?.notificationConsumerStatus);
  }, { timeout: 45_000 }).toBe(true);
  return result!;
}
export async function requestNotification(request: APIRequestContext, actor: PaymentActor, transactionId: string, commandId?: string) {
  const previous = (await records(request, 'outboxEvents')).map(row => row.id);
  const transaction = (await records(request, 'expenses')).find(row => row.id === transactionId)!;
  const payload = { transactionId, expectedVersion: transaction.aggregateVersion };
  const result = await paymentCommand(request, actor, 'ledger.request-notification.v1', payload, commandId);
  const event = await waitForOutbox(request, transactionId, 'HouseholdNotificationRequested', previous);
  return { event, result, payload };
}
export async function requestNotificationThroughUi(page: Page, transactionId: string) {
  const previous = (await records(page.request, 'outboxEvents')).map(row => row.id);
  const dialog = await openExpenseEdit(page, transactionId);
  await dialog.getByRole('button', { name: '알림 보내기', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  return waitForOutbox(page.request, transactionId, 'HouseholdNotificationRequested', previous);
}
/** Re-deliver the real producer's envelope. Only broker id/delivery time are fixtures. */
export async function redeliverOutbox(request: APIRequestContext, event: Record<string, any>, overrides: Record<string, unknown> = {}) {
  const { id: _id, notificationConsumerStatus: _status, notificationConsumerCode: _code, notificationConsumerProcessedAt: _processed, terminalAt: _terminal, expiresAt: _expires, ...envelope } = event;
  const id = `broker-redelivery-${randomUUID()}`;
  await writeFirestoreFixture(request, `outboxEvents/${id}`, firestoreFields({ ...envelope, ...overrides }));
  let replay: Record<string, any> | undefined;
  await expect.poll(async () => {
    replay = (await records(request, 'outboxEvents')).find(row => row.id === id);
    return Boolean(replay?.notificationConsumerStatus);
  }, { timeout: 45_000 }).toBe(true);
  return replay!;
}
export async function deliveriesFor(request: APIRequestContext, event: Record<string, any>) {
  const intents = (await records(request, 'notificationIntents')).filter(row => row.eventId === event.eventId);
  return (await records(request, 'notificationDeliveries')).filter(row => intents.some(intent => intent.intentId === row.intentId));
}
export async function setPushDelivery(request: APIRequestContext, actor: PaymentActor, value: 'enabled' | 'disabled') {
  await writeFirestoreFixture(request, `households/${actor.householdId}/notificationRecipientPreferences/${actor.memberId}`, firestoreFields({ householdId: actor.householdId, memberId: actor.memberId, pushDelivery: value }));
}
export async function adminAccess(request: APIRequestContext, token: string, operation: string, payload: unknown) {
  const id = `notifications-admin-${randomUUID()}`;
  const response = await callEmulatorFunction<any>(request, 'executeAdminAccess', { contractVersion: 'admin-access.v1', requestId: id, idempotencyKey: id, operation, payload }, token);
  expect(response.result.kind, JSON.stringify(response)).toBe('succeeded');
  return response.result.value;
}
/** Executes the actual compiled production participant and Firestore UoW, not a reference model.
 * Access's complete approval/process orchestration is separately tested by access E2E. */
export async function purgeNotificationPage(input: { householdId: string; processId: string; checkpoint: string; allowed?: boolean; lifecycle?: boolean }) {
  const packagePath = path.resolve(process.cwd(), '../functions/package.json');
  const code = `const req=require('node:module').createRequire(process.argv[1]);const input=JSON.parse(process.argv[2]);if(process.env.GCLOUD_PROJECT!=='demo-household-account-e2e'||process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw Error('LOCAL_DEMO_REQUIRED');req('firebase-admin/app').initializeApp({projectId:process.env.GCLOUD_PROJECT});const app=req('./lib/adapters/firebase/notifications/firebaseNotificationHouseholdPurgeStore.js').createFirebaseNotificationHouseholdPurgeApplication(req('firebase-admin/firestore').getFirestore(),2);const action=input.lifecycle?app.handleHouseholdLifecycleSignal({eventType:'HouseholdDeleted.v1',householdId:input.householdId}):app.purgeHouseholdData({systemRef:'e2e-access-participant',capabilities:input.allowed?['householdLifecycle:purge']:[]},input);action.then(result=>{console.log('NOTIFICATION_PURGE:'+JSON.stringify(result));process.exit(0)}).catch(error=>{console.error(error);process.exit(1)});`;
  const output = await promisify(execFile)(process.execPath, ['-e', code, packagePath, JSON.stringify(input)], {
    env: { ...process.env, DEBUG: '', GCLOUD_PROJECT: E2E_PROJECT_ID, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, timeout: 30_000,
  });
  return JSON.parse(output.stdout.split('\n').find(line => line.startsWith('NOTIFICATION_PURGE:'))!.slice('NOTIFICATION_PURGE:'.length));
}

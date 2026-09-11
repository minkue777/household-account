import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { callEmulatorFunction, createEmulatorAccount, createHouseholdThroughUi, E2E_PROJECT_ID, executeHouseholdCommand, firestoreFields, resetTestAccount, signInTestAccount, writeFirestoreFixture } from './emulator';
import { addExpenseThroughUi, documentId } from './finance-helpers';
import { issueShortcut, paymentCommand, rawNotification, records, registerCard, shortcutMessage, submitRaw, submitShortcut } from './payment-helpers';
import { setEmulatorAdminClaims } from './portfolio-helpers';
import { adminAccess, deliveriesFor, endpointId, joinNotificationHousehold, nativeCaptureActor, purgeNotificationPage, redeliverOutbox, registerEndpoint, requestNotification, requestNotificationThroughUi, setPushDelivery, waitForOutbox } from './notifications-helpers';

test.beforeEach(async () => { await resetTestAccount(); });

test('[PUSH-005][PUSH-008][PUSH-010] 수정 화면의 알림 보내기는 생성자와 다른 요청자를 제외하고 나머지 두 멤버의 모든 기기에 한 번만 보낸다', async ({ page, request, browser }) => {
  const creator = await createHouseholdThroughUi(page);
  const requester = await joinNotificationHousehold(request, creator, 'notification-requester');
  const third = await joinNotificationHousehold(request, creator, 'notification-third');
  for (const [actor, prefix] of [[creator, 'creator'], [requester, 'requester'], [third, 'third']] as const) {
    await registerEndpoint(request, actor, `${prefix}-android`);
    await registerEndpoint(request, actor, `${prefix}-ios`, 'ios-pwa');
  }
  const expense = await addExpenseThroughUi(page, request, { merchant: '세 명 함께 저녁', amount: 45_000 });
  const transactionId = documentId(expense);
  expect((await waitForOutbox(request, transactionId, 'TransactionRecorded')).notificationConsumerStatus).toBe('NoTarget');
  expect(await records(request, 'e2eFcmTransport')).toHaveLength(0);
  const context = await browser.newContext();
  try {
    const requesterPage = await context.newPage();
    await requesterPage.goto('/?e2eEmail=notification-requester%40household.test');
    await requesterPage.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
    await expect(requesterPage.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
    const event = await requestNotificationThroughUi(requesterPage, transactionId);
    expect(event.payload.requesterMemberId).toBe(requester.memberId);
    expect(event.notificationConsumerStatus).toBe('Completed');
    const attempts = await records(request, 'e2eFcmTransport');
    expect(attempts.map(row => row.message.fid).sort()).toEqual(['creator-android', 'creator-ios', 'third-android', 'third-ios']);
    for (const attempt of attempts) expect(attempt.message.data).toMatchObject({ payloadVersion: 'notification-payload.v1', expenseId: transactionId });
    const deliveries = await deliveriesFor(request, event);
    expect(deliveries).toHaveLength(4);
    expect(new Set(deliveries.map(row => row.recipientMemberId))).toEqual(new Set([creator.memberId, third.memberId]));
    for (const delivery of deliveries) {
      expect(delivery).toMatchObject({ status: 'delivered', providerAttemptCount: 1 });
      expect(Date.parse(delivery.expiresAt) - Date.parse(delivery.terminalAt)).toBe(30 * 86400_000);
    }
    await Promise.all([redeliverOutbox(request, event), redeliverOutbox(request, event)]);
    expect(await records(request, 'e2eFcmTransport')).toHaveLength(4);
    expect(await deliveriesFor(request, event)).toEqual(deliveries);
  } finally { await context.close(); }
});

test('[PUSH-004][PUSH-014][IOS-008] Android 수집은 푸시 없이 저장하고 Shortcut은 본인 iOS만 알리며 운영 수신 설정은 수집과 endpoint를 유지한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const other = await joinNotificationHousehold(request, actor, 'notification-other');
  await registerCard(request, actor);
  await registerEndpoint(request, actor, 'capture-android');
  await registerEndpoint(request, actor, 'capture-ios-one', 'ios-pwa');
  await registerEndpoint(request, actor, 'capture-ios-two', 'ios-pwa');
  await registerEndpoint(request, other, 'other-ios', 'ios-pwa');
  await submitRaw(request, actor, rawNotification({ merchant: 'Android 푸시 없는 수집', amount: 8000 }));
  const androidExpense = (await records(request, 'expenses')).find(row => row.merchant === 'Android 푸시 없는 수집')!;
  expect((await waitForOutbox(request, androidExpense.id, 'TransactionRecorded')).notificationConsumerStatus).toBe('NoTarget');
  expect(await records(request, 'e2eFcmTransport')).toHaveLength(0);
  const credential = await issueShortcut(request, actor);
  expect((await submitShortcut(request, credential.rawCredential, shortcutMessage({ merchant: '본인 iOS 편집 알림' }))).status).toBe(200);
  const iosExpense = (await records(request, 'expenses')).find(row => row.merchant === '본인 iOS 편집 알림')!;
  await waitForOutbox(request, iosExpense.id, 'TransactionRecorded');
  expect((await records(request, 'e2eFcmTransport')).map(row => row.message.fid).sort()).toEqual(['capture-ios-one', 'capture-ios-two']);
  const endpoints = await records(request, 'notificationEndpoints');
  await setPushDelivery(request, actor, 'disabled');
  expect((await submitShortcut(request, credential.rawCredential, shortcutMessage({ merchant: '수집 전용 유지', amount: 4200 }))).status).toBe(200);
  const disabledExpense = (await records(request, 'expenses')).find(row => row.merchant === '수집 전용 유지')!;
  expect((await waitForOutbox(request, disabledExpense.id, 'TransactionRecorded')).notificationConsumerStatus).toBe('NoTarget');
  expect((await requestNotification(request, other, disabledExpense.id)).event.notificationConsumerStatus).toBe('NoTarget');
  expect(await records(request, 'notificationEndpoints')).toEqual(endpoints);
  expect(await records(request, 'e2eFcmTransport')).toHaveLength(2);
  await setPushDelivery(request, actor, 'enabled');
  await requestNotification(request, other, disabledExpense.id);
  expect((await records(request, 'e2eFcmTransport')).map(row => row.message.fid).sort()).toEqual(['capture-android', 'capture-ios-one', 'capture-ios-one', 'capture-ios-two', 'capture-ios-two']);
  const preferenceUrl = `http://127.0.0.1:8080/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents/households/${actor.householdId}/notificationRecipientPreferences/${actor.memberId}`;
  const regularWrite = await request.patch(preferenceUrl, { headers: { authorization: `Bearer ${actor.idToken}` }, data: { fields: firestoreFields({ pushDelivery: 'disabled' }) } });
  expect(regularWrite.status()).toBe(403);
  const deletion = await request.delete(preferenceUrl, { headers: { authorization: 'Bearer owner' } });
  expect(deletion.ok()).toBe(true);
  const defaultEnabled = await requestNotification(request, other, disabledExpense.id);
  expect(await deliveriesFor(request, defaultEnabled.event)).toHaveLength(3);
  expect((await records(request, 'notificationEndpoints')).every(row => row.status === 'active')).toBe(true);
});

test('[T-PUSH-SEC-001][PUSH-001][PUSH-002][PUSH-003][PUSH-008][PUSH-009] 인증된 FID 등록·재등록·로그아웃·조건부 해제는 실제 저장소에 설치별 수명주기를 유지한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const other = await joinNotificationHousehold(request, actor, 'endpoint-other');
  const first = await registerEndpoint(request, actor, 'installation-one');
  const refreshed = await registerEndpoint(request, actor, 'installation-one');
  expect(refreshed.registrationVersion).toBe(first.registrationVersion + 1);
  await registerEndpoint(request, actor, 'installation-two', 'ios-pwa');
  let endpoints = await records(request, 'notificationEndpoints');
  expect(endpoints).toHaveLength(2);
  expect(endpoints.every(row => row.status === 'active' && row.expiresAt === undefined)).toBe(true);
  const stale = await paymentCommand(request, actor, 'notifications.remove-endpoint.v1', { fid: 'installation-one', reason: 'sdk-unregistered', expectedRegistrationVersion: first.registrationVersion });
  expect(stale.kind).toBe('stale-ignored');
  await paymentCommand(request, actor, 'notifications.remove-endpoint.v1', { fid: 'installation-one', reason: 'sdk-unregistered', expectedRegistrationVersion: refreshed.registrationVersion });
  const inactive = (await records(request, 'notificationEndpoints')).find(row => row.fid === 'installation-one')!;
  expect(inactive.status).toBe('inactive');
  expect(Date.parse(inactive.expiresAt) - Date.parse(inactive.inactiveAt)).toBe(30 * 86400_000);
  await registerEndpoint(request, actor, 'installation-one');
  const recovered = (await records(request, 'notificationEndpoints')).find(row => row.fid === 'installation-one')!;
  expect(recovered.status).toBe('active');
  expect(recovered.expiresAt).toBeUndefined();
  await paymentCommand(request, actor, 'notifications.remove-endpoint.v1', { fid: 'installation-two', reason: 'logout' });
  expect((await records(request, 'notificationEndpoints')).map(row => row.fid)).toEqual(['installation-one']);
  await registerEndpoint(request, other, 'installation-one');
  const rebound = (await records(request, 'notificationEndpoints'))[0];
  expect(rebound.memberId).toBe(other.memberId);
  expect(rebound.bindingVersion).toBe(recovered.bindingVersion + 1);
  expect((await paymentCommand(request, actor, 'notifications.remove-endpoint.v1', { fid: 'installation-one', reason: 'logout' })).kind).toBe('stale-ignored');
  endpoints = await records(request, 'notificationEndpoints');
  for (const payload of [{ fid: 'installation-one', platform: 'desktop' }, { fid: '', platform: 'android' }, { fid: 'installation-one', platform: 'android', memberId: other.memberId }]) {
    await expect(paymentCommand(request, actor, 'notifications.register-endpoint.v1', payload)).rejects.toThrow();
  }
  await expect(paymentCommand(request, { ...actor, householdId: 'another-household' }, 'notifications.register-endpoint.v1', { fid: 'installation-one', platform: 'android' })).rejects.toThrow();
  const unauthenticated = await callEmulatorFunction<any>(request, 'executeHouseholdCommand', { contractVersion: 'household-command.v1', commandId: 'unauth-endpoint', idempotencyKey: 'unauth-endpoint', householdId: actor.householdId, command: 'notifications.register-endpoint.v1', payload: { fid: 'installation-one', platform: 'android' } });
  expect(unauthenticated.result).toMatchObject({ kind: 'rejected', error: { code: 'AUTH_REQUIRED', retryable: false } });
  expect(await records(request, 'notificationEndpoints')).toEqual(endpoints);
  const privateRead = await request.get(`http://127.0.0.1:8080/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents/notificationEndpoints/${rebound.id}`, { headers: { authorization: `Bearer ${actor.idToken}` } });
  expect(privateRead.status()).toBe(403);
});

test('[PUSH-008][PUSH-010] provider 오류는 각 한 번만 시도하고 현재 404 UNREGISTERED만 비활성화하며 늦은 응답은 새 등록을 보존한다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const recipient = await joinNotificationHousehold(request, actor, 'provider-recipient');
  for (const suffix of ['unregistered', 'timeout', 'quota', 'credential', 'network']) await registerEndpoint(request, recipient, `provider-${suffix}`);
  const expense = await addExpenseThroughUi(page, request, { merchant: '오류 분류 검증', amount: 6700 });
  const transactionId = documentId(expense);
  const event = await requestNotificationThroughUi(page, transactionId);
  const deliveries = await deliveriesFor(request, event);
  expect(deliveries).toHaveLength(5);
  const errors: Record<string, string> = { unregistered: 'FID_UNREGISTERED', timeout: 'PROVIDER_TIMEOUT', quota: 'PROVIDER_QUOTA', credential: 'PROVIDER_CREDENTIAL_INVALID', network: 'PROVIDER_NETWORK_ERROR' };
  for (const [suffix, errorCode] of Object.entries(errors)) {
    expect(deliveries.find(row => row.endpointId === endpointId(`provider-${suffix}`))).toMatchObject({ providerAttemptCount: 1, errorCode });
    expect((await records(request, 'notificationEndpoints')).find(row => row.fid === `provider-${suffix}`)?.status).toBe(suffix === 'unregistered' ? 'inactive' : 'active');
  }
  await redeliverOutbox(request, event);
  expect(await records(request, 'e2eFcmTransport')).toHaveLength(5);
  for (const suffix of ['timeout', 'quota', 'credential', 'network']) await paymentCommand(request, recipient, 'notifications.remove-endpoint.v1', { fid: `provider-${suffix}`, reason: 'logout' });
  const fid = 'provider-delayed-unregistered';
  const original = await registerEndpoint(request, recipient, fid);
  const pending = requestNotification(request, actor, transactionId);
  await expect.poll(async () => (await records(request, 'e2eFcmTransport')).some(row => row.message.fid === fid)).toBe(true);
  const refreshed = await registerEndpoint(request, recipient, fid);
  expect(refreshed.registrationVersion).toBe(original.registrationVersion + 1);
  await writeFirestoreFixture(request, `e2eFcmTransportControls/${endpointId(fid)}`, firestoreFields({ released: true }));
  const delayed = await pending;
  expect((await deliveriesFor(request, delayed.event))[0]).toMatchObject({ providerAttemptCount: 1, errorCode: 'FID_UNREGISTERED' });
  expect((await records(request, 'notificationEndpoints')).find(row => row.fid === fid)).toMatchObject({ status: 'active', registrationVersion: refreshed.registrationVersion });
  await redeliverOutbox(request, delayed.event);
  expect((await records(request, 'e2eFcmTransport')).filter(row => row.message.fid === fid)).toHaveLength(1);
});

test('[PUSH-012] 실제 관리자 제거와 복구는 endpoint와 이미 인증된 수집 권한을 즉시 정리하고 복구 후 새 등록으로 알림을 되살린다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const removed = await joinNotificationHousehold(request, actor, 'removed-recipient');
  const retained = await joinNotificationHousehold(request, actor, 'retained-recipient');
  await registerEndpoint(request, removed, 'removed-android');
  await registerEndpoint(request, removed, 'removed-ios', 'ios-pwa');
  await registerEndpoint(request, retained, 'retained-ios', 'ios-pwa');
  await registerCard(request, removed);
  const native = await nativeCaptureActor(request, removed);
  // Warm the ordinary membership cache and the Native token-claim path before removal.
  for (const [index, captureActor] of [[0, removed], [1, native]] as const) {
    const merchant = `제거 전 수집 ${index}`;
    await submitRaw(request, captureActor, rawNotification({ merchant, amount: 2300 + index }));
    expect((await records(request, 'expenses')).find(row => row.merchant === merchant))
      .toMatchObject({ creatorMemberId: removed.memberId, amount: 2300 + index });
  }
  const expense = await addExpenseThroughUi(page, request, { merchant: '멤버 제거와 복구', amount: 4000 });
  const transactionId = documentId(expense);
  const first = await requestNotificationThroughUi(page, transactionId);
  const oldDeliveries = await deliveriesFor(request, first);
  await setEmulatorAdminClaims(actor.uid);
  const admin = await signInTestAccount(request);
  let member = (await records(request, `households/${actor.householdId}/members`)).find(row => row.id === removed.memberId)!;
  await adminAccess(request, admin.idToken, 'remove-household-member', { householdId: actor.householdId, memberId: removed.memberId, expectedVersion: member.aggregateVersion, reason: '알림 E2E 제거' });
  await expect.poll(async () => (await records(request, 'notificationEndpoints')).filter(row => row.memberId === removed.memberId).length).toBe(0);
  const beforeDeniedCapture = await records(request, 'expenses');
  const beforeDeniedReceipts = await records(request, `households/${actor.householdId}/captureSubmissionReceipts`);
  const deniedCaptures = await Promise.allSettled([removed, native].map((captureActor, index) =>
    submitRaw(request, captureActor, rawNotification({ merchant: `제거 후 거부 ${index}`, amount: 3300 + index }))));
  expect(deniedCaptures.map(result => result.status), 'Both existing ordinary and Native claim JWTs must be rejected')
    .toEqual(['rejected', 'rejected']);
  for (const result of deniedCaptures) if (result.status === 'rejected') {
    expect(String(result.reason)).toContain('ACTIVE_HOUSEHOLD_MEMBERSHIP_REQUIRED');
  }
  expect(await records(request, 'expenses')).toEqual(beforeDeniedCapture);
  expect(await records(request, `households/${actor.householdId}/captureSubmissionReceipts`)).toEqual(beforeDeniedReceipts);
  const cleanup = (await records(request, 'outboxEvents')).find(row => row.eventType === 'HouseholdMemberRemoved' && row.payload.memberId === removed.memberId)!;
  await redeliverOutbox(request, cleanup);
  expect((await records(request, 'notificationEndpoints')).map(row => row.fid)).toEqual(['retained-ios']);
  expect(await deliveriesFor(request, first)).toEqual(oldDeliveries);
  const whileRemoved = await requestNotification(request, actor, transactionId);
  expect((await deliveriesFor(request, whileRemoved.event)).map(row => row.recipientMemberId)).toEqual([retained.memberId]);
  await expect(registerEndpoint(request, removed, 'removed-denied')).rejects.toThrow();
  member = (await records(request, `households/${actor.householdId}/members`)).find(row => row.id === removed.memberId)!;
  await adminAccess(request, admin.idToken, 'restore-household-member', { householdId: actor.householdId, memberId: removed.memberId, expectedVersion: member.aggregateVersion });
  expect((await records(request, 'notificationEndpoints')).map(row => row.fid)).toEqual(['retained-ios']);
  // Keep the same pre-removal Auth tokens: current membership, not a stale claim/cache, decides.
  for (const [index, captureActor] of [[0, removed], [1, native]] as const) {
    const merchant = `복구 후 수집 ${index}`;
    await submitRaw(request, captureActor, rawNotification({ merchant, amount: 4300 + index }));
    expect((await records(request, 'expenses')).find(row => row.merchant === merchant))
      .toMatchObject({ creatorMemberId: removed.memberId, amount: 4300 + index });
  }
  await registerEndpoint(request, removed, 'removed-ios', 'ios-pwa');
  const afterRestore = await requestNotification(request, actor, transactionId);
  expect(new Set((await deliveriesFor(request, afterRestore.event)).map(row => row.recipientMemberId))).toEqual(new Set([removed.memberId, retained.memberId]));
});

test('[PUSH-004][PUSH-010] 30일 지난 실제 이벤트의 재도착과 알 수 없는 채널은 provider 호출 없이 명시적 terminal 결과를 남긴다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const recipient = await joinNotificationHousehold(request, actor, 'retention-recipient');
  await registerEndpoint(request, recipient, 'retention-ios', 'ios-pwa');
  const expense = await addExpenseThroughUi(page, request, { merchant: '유효 기간 검증', amount: 3900 });
  const transactionId = documentId(expense);
  const created = await waitForOutbox(request, transactionId, 'TransactionRecorded');
  for (const originChannel of ['recurring', 'system']) {
    const suppressed = await redeliverOutbox(request, created, { eventId: `${originChannel}-${randomUUID()}`, payload: { ...created.payload, originChannel } });
    expect(suppressed.notificationConsumerStatus).toBe('NoTarget');
  }
  const unknown = await redeliverOutbox(request, created, { eventId: `unknown-${randomUUID()}`, payload: { ...created.payload, originChannel: 'unsupported-channel' } });
  expect(unknown).toMatchObject({ notificationConsumerStatus: 'ContractFailure', notificationConsumerCode: 'UNKNOWN_ORIGIN_CHANNEL' });
  const requested = await requestNotificationThroughUi(page, transactionId);
  const before = await records(request, 'e2eFcmTransport');
  const expired = await redeliverOutbox(request, requested, { eventId: `expired-${randomUUID()}`, occurredAt: new Date(Date.now() - 31 * 86400_000).toISOString() });
  expect(expired.notificationConsumerStatus).toBe('ExpiredEvent');
  expect(await records(request, 'e2eFcmTransport')).toEqual(before);
  const inbox = (await records(request, 'notificationInboxes')).find(row => row.eventId === expired.eventId)!;
  expect(inbox.code).toBe('EXPIRED_EVENT');
  expect(Date.parse(inbox.expiresAt) - Date.parse(inbox.terminalAt)).toBe(30 * 86400_000);
});

test('[PUSH-013] 실제 Notifications purge 참여자는 승인 capability와 page 영수증을 적용하고 다른 가구·전송 이력을 건드리지 않는다', async ({ page, request }) => {
  const actor = await createHouseholdThroughUi(page);
  const recipient = await joinNotificationHousehold(request, actor, 'purge-recipient');
  await registerEndpoint(request, recipient, 'purge-one');
  await registerEndpoint(request, recipient, 'purge-two', 'ios-pwa');
  const expense = await addExpenseThroughUi(page, request, { merchant: 'purge 대상 데이터', amount: 3000 });
  await requestNotificationThroughUi(page, documentId(expense));
  const outsiderAccount = await createEmulatorAccount(request, 'purge-outsider@household.test');
  const outside = await executeHouseholdCommand<{ householdId: string; memberId: string }>(request, { idToken: outsiderAccount.idToken, command: 'access.create-household-with-self.v1', payload: { householdName: '보존할 가구', memberName: '외부 멤버' } });
  await registerEndpoint(request, { ...outsiderAccount, ...outside }, 'outside-installation');
  const outsideBefore = (await records(request, 'notificationEndpoints')).find(row => row.householdId === outside.householdId)!;
  const providerBefore = await records(request, 'e2eFcmTransport');
  const processId = `purge-${randomUUID()}`;
  const input = { householdId: actor.householdId, processId, checkpoint: 'START' };
  const before = await records(request, 'notificationEndpoints');
  expect(await purgeNotificationPage(input)).toMatchObject({ kind: 'Forbidden', code: 'PURGE_SYSTEM_CAPABILITY_REQUIRED' });
  expect(await purgeNotificationPage({ ...input, lifecycle: true })).toMatchObject({ kind: 'Ignored', reason: 'LOGICAL_DELETE_DOES_NOT_PURGE' });
  expect(await records(request, 'notificationEndpoints')).toEqual(before);
  let checkpoint = 'START';
  let completed = false;
  for (let pageNumber = 0; pageNumber < 30; pageNumber++) {
    const pageInput = { ...input, checkpoint, allowed: true };
    const result = await purgeNotificationPage(pageInput);
    expect(await purgeNotificationPage(pageInput)).toEqual(result);
    if (result.kind === 'PurgeCompleted') { completed = true; break; }
    expect(result.kind).toBe('PageProcessed');
    expect(result.nextCheckpoint).not.toBe(checkpoint);
    checkpoint = result.nextCheckpoint;
  }
  expect(completed).toBe(true);
  for (const collection of ['notificationEndpoints', 'notificationIntents', 'notificationDeliveries', 'notificationInboxes']) expect((await records(request, collection)).filter(row => row.householdId === actor.householdId)).toHaveLength(0);
  expect((await records(request, 'notificationEndpoints')).find(row => row.householdId === outside.householdId)).toEqual(outsideBefore);
  expect(await records(request, 'e2eFcmTransport')).toEqual(providerBefore);
});

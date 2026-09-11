import { expect, test, type Page } from '@playwright/test';
import {
  createEmulatorAccount, createHouseholdThroughUi, E2E_PROJECT_ID, executeHouseholdCommand,
  firestoreFields, readExpenseDocuments, readFirestoreCollection, resetTestAccount, signInTestAccount, writeFirestoreFixture,
} from './emulator';
import { addExpenseThroughUi, documentId, seoulDate, textField } from './finance-helpers';

test.beforeEach(async () => { await resetTestAccount(); });

async function issueInvitation(page: Page): Promise<string> {
  await page.goto('/settings');
  await page.getByRole('button', { name: '코드 생성', exact: true }).click();
  await expect(page.locator('code')).toHaveText(/\S+/);
  return (await page.locator('code').innerText()).trim();
}

async function joinThroughUi(page: Page, email: string, code: string, name: string): Promise<void> {
  await page.goto(`/join?e2eEmail=${encodeURIComponent(email)}&code=${encodeURIComponent(code)}`);
  await page.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
  await expect(page.getByRole('heading', { name: '초대받은 가계부 참여' })).toBeVisible();
  await page.getByPlaceholder('내 이름').fill(name);
  await page.getByRole('button', { name: '참여하기', exact: true }).click();
  await page.getByRole('link', { name: '가계부로 돌아가기', exact: true }).click();
  await expect(page.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
}

test('[HH-003][HH-006][HH-007][HH-JOIN-001] 세 Google Principal은 실제 일회용 초대 UI로 자기 Member만 생성하고 같은 원장을 공유한다', async ({ page, browser, request }) => {
  const owner = await createHouseholdThroughUi(page, '또니망고', '망고');
  expect(owner.householdId).toMatch(/^[a-f0-9]{32}$/);
  expect((await readFirestoreCollection(request, 'households'))[0].fields).toMatchObject({ name: { stringValue: '또니망고네' }, initializationStatus: { stringValue: 'completed' } });
  const expense = await addExpenseThroughUi(page, request, { merchant: '세 사람이 보는 원장', amount: 9876, date: seoulDate(0, 1) });
  const code = await issueInvitation(page);
  await expect(page.getByText('5분간 유효한 초대 코드', { exact: true })).toBeVisible();
  const invitationCard = page.getByText('가구원 초대', { exact: true });
  const theme = page.getByText('테마', { exact: true });
  expect((await theme.boundingBox())!.y).toBeLessThan((await invitationCard.boundingBox())!.y);
  const invitations = await readFirestoreCollection(request, 'householdInvitations');
  expect(JSON.stringify(invitations)).not.toContain(code);
  expect(invitations).toHaveLength(1);
  const [secondAccount, thirdAccount] = await Promise.all([
    createEmulatorAccount(request, 'ttoni@household.test'), createEmulatorAccount(request, 'child@household.test'),
  ]);
  const secondContext = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  const thirdContext = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const secondPage = await secondContext.newPage();
    await joinThroughUi(secondPage, 'ttoni@household.test', code, '또니');
    await secondPage.getByTestId(/^calendar-day-/).first().click();
    await expect(secondPage.getByTestId('expense-item').filter({ hasText: '세 사람이 보는 원장' })).toContainText('9,876원');
    await expect(executeHouseholdCommand(request, { idToken: thirdAccount.idToken, command: 'access.join-household-as-self.v1', payload: { invitationCode: code, memberName: '아이' } })).rejects.toThrow();
    expect(await readFirestoreCollection(request, `households/${owner.householdId}/members`)).toHaveLength(2);
    const nextCode = await issueInvitation(page);
    await expect(executeHouseholdCommand(request, { idToken: secondAccount.idToken, command: 'access.join-household-as-self.v1', payload: { invitationCode: nextCode, memberName: '다른 이름' } })).rejects.toThrow();
    const thirdPage = await thirdContext.newPage();
    await joinThroughUi(thirdPage, 'child@household.test', nextCode, '아이');
    const members = await readFirestoreCollection(request, `households/${owner.householdId}/members`);
    expect(members.map(member => textField(member, 'displayName')).sort()).toEqual(['또니', '망고', '아이']);
    expect(new Set(members.map(member => textField(member, 'linkedPrincipalUid')))).toEqual(new Set([owner.uid, secondAccount.uid, thirdAccount.uid]));
    expect(await readFirestoreCollection(request, 'principalMembershipClaims')).toHaveLength(3);
    expect((await readExpenseDocuments(request)).map(documentId)).toEqual([documentId(expense)]);
    await thirdPage.getByTestId(/^calendar-day-/).first().click();
    await expect(thirdPage.getByTestId('expense-item').filter({ hasText: '세 사람이 보는 원장' })).toBeVisible();
    await expect(thirdPage.getByRole('button', { name: /가구원 추가|멤버 선택|가계부 탈퇴/ })).toHaveCount(0);
  } finally { await secondContext.close(); await thirdContext.close(); }
});

test('[T-HH-005][HH-004][HH-005][HH-009][HH-010][SYS-006][SYS-008] 로그아웃 후 재로그인은 동일 Membership을 복원하고 자기 이름 수정은 참조 ID를 유지한다', async ({ page, request }) => {
  const session = await createHouseholdThroughUi(page, '재로그인', '이전 이름');
  const expense = await addExpenseThroughUi(page, request, { merchant: '이름 변경 전 거래', amount: 4400 });
  await executeHouseholdCommand(request, { idToken: session.idToken, householdId: session.householdId, command: 'access.rename-self.v1', payload: { displayName: '새 이름', expectedVersion: 1 } });
  expect((await readFirestoreCollection(request, `households/${session.householdId}/members`))[0].fields).toMatchObject({ memberId: { stringValue: session.memberId }, displayName: { stringValue: '새 이름' } });
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: /탈퇴|가구원 추가|멤버 추가/ })).toHaveCount(0);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('button', { name: '테스트 계정으로 로그인' })).toBeVisible();
  expect(await page.evaluate(() => [localStorage.getItem('householdKey'), localStorage.getItem('currentMemberId'), localStorage.getItem('currentMemberName')])).toEqual([null, null, null]);
  const memberships = await readFirestoreCollection(request, `households/${session.householdId}/memberships`);
  expect(memberships).toHaveLength(1);
  expect(textField(memberships[0], 'memberId')).toBe(session.memberId);
  await page.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
  await expect(page.getByText('새 이름', { exact: true })).toBeVisible();
  const restored = await executeHouseholdCommand<{ kind: string; membership: { householdId: string; memberId: string } }>(request, { idToken: session.idToken, command: 'access.resolve-signed-in-user.v1', payload: {} });
  expect(restored.membership).toMatchObject({ householdId: session.householdId, memberId: session.memberId });
  expect((await readExpenseDocuments(request))[0].fields?.creatorMemberId?.stringValue).toBe(expense.fields?.creatorMemberId?.stringValue);
  expect((await readFirestoreCollection(request, `households/${session.householdId}/assetOwnerProfiles`))[0].fields).toMatchObject({ linkedMemberId: { stringValue: session.memberId }, displayName: { stringValue: '새 이름' } });
});

test('[T-HH-001][HH-006][HH-008][HH-009][SYS-001] 다른 가구 ID·Member 위조와 직접 Firestore 쓰기는 실제 서버와 Rules가 차단한다', async ({ page, request }) => {
  const owner = await createHouseholdThroughUi(page, '접근 확인', '원장 주인');
  const expense = await addExpenseThroughUi(page, request, { merchant: '보호된 거래', amount: 1234 });
  const outsider = await createEmulatorAccount(request, 'outsider@household.test');
  const other = await executeHouseholdCommand<{ householdId: string; memberId: string }>(request, { idToken: outsider.idToken, command: 'access.create-household-with-self.v1', payload: { householdName: '다른 집', memberName: '외부 사용자' } });
  await expect(executeHouseholdCommand(request, { idToken: outsider.idToken, householdId: owner.householdId, command: 'ledger.update-transaction.v1', payload: { transactionId: documentId(expense), expectedVersion: 1, patch: { amountInWon: 9999 } } })).rejects.toThrow();
  await expect(executeHouseholdCommand(request, { idToken: outsider.idToken, householdId: owner.householdId, command: 'access.rename-self.v1', payload: { displayName: '가로챈 이름', expectedVersion: 1 } })).rejects.toThrow();
  await expect(executeHouseholdCommand(request, { idToken: outsider.idToken, householdId: other.householdId, command: 'access.rename-self.v1', payload: { displayName: '자기 이름', expectedVersion: 1, memberId: owner.memberId, principalUid: owner.uid } })).rejects.toThrow('FORBIDDEN_IDENTITY_FIELD');
  expect((await readFirestoreCollection(request, `households/${owner.householdId}/members`))[0].fields?.displayName?.stringValue).toBe('원장 주인');
  const endpoint = `http://127.0.0.1:8080/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents/expenses/${documentId(expense)}`;
  const deniedRead = await request.get(endpoint, { headers: { authorization: `Bearer ${outsider.idToken}` } });
  expect(deniedRead.status()).toBe(403);
  const deniedWrite = await request.patch(endpoint, { headers: { authorization: `Bearer ${owner.idToken}` }, data: { fields: firestoreFields({ householdId: owner.householdId, amount: 9999 }) } });
  expect(deniedWrite.status()).toBe(403);
  expect((await readExpenseDocuments(request))[0].fields?.amount?.integerValue).toBe('1234');
});

test('[HH-001][HH-002][SYS-002] legacy 기기 연결은 기존 가구·Member ID와 type 없는 거래를 복사 없이 연결하고 다른 UID의 재연결을 거부한다', async ({ page, request }) => {
  const householdId = 'legacy-household-e2e';
  const memberId = 'legacy-member-e2e';
  await writeFirestoreFixture(request, `households/${householdId}`, firestoreFields({ name: '기존가구네', lifecycleState: 'active', members: [{ id: memberId, name: '기존 사용자' }] }));
  await writeFirestoreFixture(request, 'expenses/legacy-expense-e2e', firestoreFields({ householdId, merchant: '기존 기록', amount: 3210, category: 'etc', date: seoulDate(0, 1), lifecycleState: 'active', aggregateVersion: 1 }));
  await page.addInitScript(({ householdId, memberId }) => {
    localStorage.setItem('householdKey', householdId); localStorage.setItem('currentMemberId', memberId); localStorage.setItem('currentMemberName', '기존 사용자');
  }, { householdId, memberId });
  await page.goto('/');
  await page.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
  await expect(page.getByRole('heading', { name: '기존 가계부 연결 확인' })).toBeVisible();
  await page.getByRole('button', { name: '기존 가계부 연결', exact: true }).click();
  await expect(page.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
  await page.getByTestId(/^calendar-day-/).first().click();
  await expect(page.getByTestId('expense-item').filter({ hasText: '기존 기록' })).toContainText('3,210원');
  const account = await signInTestAccount(request);
  const payload = { legacyHouseholdId: householdId, legacyMemberId: memberId, legacyMemberName: '기존 사용자' };
  await expect(executeHouseholdCommand(request, { idToken: account.idToken, command: 'access.claim-legacy-membership.v1', payload })).resolves.toMatchObject({ householdId, memberId });
  const outsider = await createEmulatorAccount(request, 'legacy-outsider@household.test');
  await expect(executeHouseholdCommand(request, { idToken: outsider.idToken, command: 'access.claim-legacy-membership.v1', payload })).rejects.toThrow();
  expect((await readExpenseDocuments(request)).map(documentId)).toEqual(['legacy-expense-e2e']);
  expect(await readFirestoreCollection(request, 'principalMembershipClaims')).toHaveLength(1);
});

test('[T-HH-JOIN-001][HH-001][HH-003][HH-008] 미완성 legacy localStorage는 보호 데이터를 노출하지 않고 신규 사용자 선택 화면으로 이동한다', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('householdKey', 'cannot-authorize-with-household-key'); });
  await page.goto('/stats');
  await expect(page.getByRole('heading', { name: '지출 통계', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
  await expect(page.getByRole('button', { name: '새 가계부 만들기' })).toBeVisible();
  await expect(page.getByRole('button', { name: '초대 코드 입력하기' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '기존 가계부 연결 확인' })).toHaveCount(0);
  await expect(page.getByPlaceholder(/가구 키|가계부 키/)).toHaveCount(0);
});

test('[HH-JOIN-001][HH-006] 만료된 초대 코드와 빈 자기 이름은 UI·실제 서버에서 거부되고 Member를 만들지 않는다', async ({ page, browser, request }) => {
  const owner = await createHouseholdThroughUi(page, '만료 검증', '초대자');
  const code = await issueInvitation(page);
  const invitation = (await readFirestoreCollection(request, 'householdInvitations'))[0];
  await writeFirestoreFixture(request, `householdInvitations/${documentId(invitation)}`, {
    ...invitation.fields!, expiresAt: { timestampValue: '2000-01-01T00:00:00Z' },
  });
  await createEmulatorAccount(request, 'expired-invitation@household.test');
  const guestContext = await browser.newContext({ baseURL: new URL(page.url()).origin, locale: 'ko-KR', timezoneId: 'Asia/Seoul' });
  try {
    const guest = await guestContext.newPage();
    await guest.goto(`/?e2eEmail=expired-invitation%40household.test&code=${encodeURIComponent(code)}`);
    await guest.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
    await expect(guest.getByRole('button', { name: '참여하기', exact: true })).toBeDisabled();
    await guest.getByPlaceholder('내 이름').fill('만료 사용자');
    await guest.getByRole('button', { name: '참여하기', exact: true }).click();
    await expect(guest.locator('p.bg-red-50')).toBeVisible();
    await expect(guest.locator('.calendar-glass')).toHaveCount(0);
    expect(await readFirestoreCollection(request, `households/${owner.householdId}/members`)).toHaveLength(1);
    expect(await readFirestoreCollection(request, 'principalMembershipClaims')).toHaveLength(1);
    expect((await readFirestoreCollection(request, 'householdInvitations'))[0].fields?.status?.stringValue).toBe('issued');
  } finally { await guestContext.close(); }
});

import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

export const E2E_PROJECT_ID = 'demo-household-account-e2e';
export const E2E_EMAIL = 'playwright@household.test';
export const E2E_PASSWORD = 'playwright-password-1234';

const AUTH_EMULATOR_ORIGIN = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR_ORIGIN = 'http://127.0.0.1:8080';

export interface FirestoreValue {
    stringValue?: string;
    integerValue?: string;
    doubleValue?: number;
    booleanValue?: boolean;
    nullValue?: null;
    timestampValue?: string;
    mapValue?: { fields?: Record<string, FirestoreValue> };
    arrayValue?: { values?: FirestoreValue[] };
}

export interface FirestoreDocument {
  name: string;
  fields?: Record<string, FirestoreValue>;
}

async function assertOk(response: Response, operation: string): Promise<void> {
  if (response.ok) return;
  throw new Error(`${operation} 실패 (${response.status}): ${await response.text()}`);
}

async function pendingNotificationConsumers(): Promise<string[]> {
  // Firestore 삭제는 Functions 실행을 취소하지 않습니다. 이전 테스트의 실제
  // consumer가 완료하기 전에 지우면 늦은 완료 쓰기가 불완전한 문서를 재생성합니다.
  const consumedEvents = new Set(['HouseholdNotificationRequested', 'TransactionRecorded', 'CaptureDuplicateObserved', 'HouseholdMemberRemoved']);
  const pending: string[] = [];
  let pageToken: string | undefined;
  do {
    const query = new URLSearchParams({ pageSize: '1000', ...(pageToken ? { pageToken } : {}) });
    const response = await fetch(`${FIRESTORE_EMULATOR_ORIGIN}/v1/projects/${E2E_PROJECT_ID}/databases/(default)/documents/outboxEvents?${query}`, {
      headers: { authorization: 'Bearer owner' },
    });
    await assertOk(response, '이전 테스트 Outbox 소비 완료 조회');
    const page = await response.json() as { documents?: FirestoreDocument[]; nextPageToken?: string };
    for (const document of page.documents ?? []) {
      const fields = document.fields ?? {};
      const type = fields.eventType?.stringValue;
      if (type && consumedEvents.has(type) && fields.eventVersion?.integerValue === '1' && !fields.notificationConsumerStatus?.stringValue) {
        pending.push(`${type}:${document.name.split('/').at(-1)}`);
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return pending.sort();
}

export async function resetEmulatorState(): Promise<void> {
  await expect.poll(pendingNotificationConsumers, {
    message: '실제 Outbox consumer 완료 후에만 다음 테스트의 DB/Auth를 초기화합니다.',
    timeout: 45_000,
    intervals: [50, 100, 250, 500],
  }).toEqual([]);
  const [authResponse, firestoreResponse] = await Promise.all([
    fetch(
      `${AUTH_EMULATOR_ORIGIN}/emulator/v1/projects/${E2E_PROJECT_ID}/accounts`,
      { method: 'DELETE' }
    ),
    fetch(
      `${FIRESTORE_EMULATOR_ORIGIN}/emulator/v1/projects/${E2E_PROJECT_ID}`
        + '/databases/(default)/documents',
      { method: 'DELETE' }
    ),
  ]);
  await Promise.all([
    assertOk(authResponse, 'Auth Emulator 초기화'),
    assertOk(firestoreResponse, 'Firestore Emulator 초기화'),
  ]);
}

export async function createTestAccount(): Promise<void> {
  const response = await fetch(
    `${AUTH_EMULATOR_ORIGIN}/identitytoolkit.googleapis.com/v1/accounts:signUp`
      + '?key=demo-api-key',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: E2E_EMAIL,
        password: E2E_PASSWORD,
        returnSecureToken: true,
      }),
    }
  );
  await assertOk(response, 'Auth Emulator 테스트 계정 생성');
}

export async function resetTestAccount(): Promise<void> {
  await resetEmulatorState();
  await createTestAccount();
}

export interface EmulatorAccount {
  uid: string;
  idToken: string;
  refreshToken: string;
}

export async function signInTestAccount(
  request: APIRequestContext,
  email = E2E_EMAIL,
  password = E2E_PASSWORD
): Promise<EmulatorAccount> {
  const response = await request.post(
    `${AUTH_EMULATOR_ORIGIN}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`,
    { data: { email, password, returnSecureToken: true } }
  );
  if (!response.ok()) throw new Error(`Auth Emulator 로그인 실패 (${response.status()})`);
  const result = await response.json();
  expect(result.idToken).toEqual(expect.any(String));
  return { uid: result.localId, idToken: result.idToken, refreshToken: result.refreshToken };
}

export async function createEmulatorAccount(
  request: APIRequestContext,
  email: string,
  password = E2E_PASSWORD
): Promise<EmulatorAccount> {
  const response = await request.post(
    `${AUTH_EMULATOR_ORIGIN}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`,
    { data: { email, password, returnSecureToken: true } }
  );
  if (!response.ok()) throw new Error(`Auth Emulator 계정 생성 실패 (${response.status()})`);
  const result = await response.json();
  return { uid: result.localId, idToken: result.idToken, refreshToken: result.refreshToken };
}

/** 인증은 실제 Emulator ID token, 실행은 배포와 동일한 callable entry를 사용합니다. */
export async function callEmulatorFunction<T>(
  request: APIRequestContext,
  functionName: string,
  data: unknown,
  idToken?: string
): Promise<T> {
  const response = await request.post(
    `http://127.0.0.1:5001/${E2E_PROJECT_ID}/asia-northeast3/${functionName}`,
    { data: { data }, headers: idToken ? { authorization: `Bearer ${idToken}` } : {}, timeout: 30_000 }
  );
  const responseText = await response.text();
  let body;
  try { body = JSON.parse(responseText); }
  catch { throw new Error(`${functionName}: HTTP ${response.status()} returned non-JSON: ${responseText.slice(0, 300)}`); }
  if (!response.ok() || body.error || body.result === undefined) {
    throw new Error(`${functionName}: ${response.status()} ${JSON.stringify(body.error ?? body)}`);
  }
  return body.result as T;
}

export async function executeHouseholdCommand<T = Record<string, unknown>>(
  request: APIRequestContext,
  input: { idToken: string; command: string; payload: unknown; householdId?: string; commandId?: string }
): Promise<T> {
  const commandId = input.commandId ?? `e2e-${randomUUID()}`;
  const result = await callEmulatorFunction<{
    contractVersion: string;
    commandId: string;
    result: { kind: string; value: T; error?: { code: string } };
  }>(request, 'executeHouseholdCommand', {
    contractVersion: 'household-command.v1', commandId, idempotencyKey: commandId,
    ...(input.householdId ? { householdId: input.householdId } : {}),
    command: input.command, payload: input.payload,
  }, input.idToken);
  expect(result.contractVersion).toBe('household-command-response.v1');
  expect(result.commandId).toBe(commandId);
  if (result.result.kind === 'rejected') throw new Error(result.result.error?.code ?? 'COMMAND_REJECTED');
  expect(['succeeded', 'already-processed']).toContain(result.result.kind);
  return result.result.value;
}

export async function createHouseholdThroughUi(
  page: Page,
  householdName = 'E2E 가계부',
  memberName = '테스터'
): Promise<EmulatorAccount & { householdId: string; memberId: string }> {
  await page.goto('/');
  await page.getByRole('button', { name: '테스트 계정으로 로그인' }).click();
  await page.getByRole('button', { name: '새 가계부 만들기' }).click();
  await page.getByLabel('가계부 이름').fill(householdName);
  await page.getByPlaceholder('내 이름').fill(memberName);
  await page.getByRole('button', { name: '가계부 만들기' }).click();
  await expect(page.locator('.calendar-glass')).toHaveAttribute('aria-busy', 'false');
  const account = await signInTestAccount(page.request);
  const resolved = await executeHouseholdCommand<{
    kind: string; membership: { householdId: string; memberId: string }
  }>(page.request, { idToken: account.idToken, command: 'access.resolve-signed-in-user.v1', payload: {} });
  expect(resolved.kind).toBe('membership-found');
  return { ...account, ...resolved.membership };
}

export function firestoreFields(value: Record<string, unknown>): Record<string, FirestoreValue> {
  const encode = (entry: unknown): FirestoreValue => {
    if (entry === null) return { nullValue: null };
    if (typeof entry === 'string') return { stringValue: entry };
    if (typeof entry === 'boolean') return { booleanValue: entry };
    if (typeof entry === 'number') return Number.isInteger(entry)
      ? { integerValue: String(entry) } : { doubleValue: entry };
    if (Array.isArray(entry)) return { arrayValue: { values: entry.map(encode) } };
    if (entry && typeof entry === 'object') return { mapValue: { fields: firestoreFields(entry as Record<string, unknown>) } };
    throw new Error(`지원하지 않는 fixture 값: ${typeof entry}`);
  };
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, encode(entry)]));
}

/** 실제 SDK의 IndexedDB 접근을 관찰하며 요청과 반환값은 그대로 전달합니다. */
export async function observeIndexedDbOpens(page: Page, iosStandalone = false): Promise<void> {
  await page.addInitScript((standalone) => {
    if (standalone) Object.defineProperty(navigator, 'standalone', { get: () => true });
    const runtime = window as typeof window & { e2eIndexedDbOpens: string[] };
    runtime.e2eIndexedDbOpens = [];
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args: Parameters<IDBFactory['open']>) {
      runtime.e2eIndexedDbOpens.push(args[0]);
      return Reflect.apply(open, this, args);
    };
  }, iosStandalone);
}

export function readIndexedDbOpens(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    (window as typeof window & { e2eIndexedDbOpens: string[] }).e2eIndexedDbOpens
  );
}

/** Read Model fixture만 준비합니다. 테스트 계정과 가구 생성은 실제 인증·Command를 통과합니다. */
export async function writeFirestoreFixture(
  request: APIRequestContext,
  path: string,
  fields: NonNullable<FirestoreDocument['fields']>
): Promise<void> {
  const response = await request.patch(
    `${FIRESTORE_EMULATOR_ORIGIN}/v1/projects/${E2E_PROJECT_ID}`
      + `/databases/(default)/documents/${path}`,
    { headers: { authorization: 'Bearer owner' }, data: { fields } }
  );
  if (!response.ok()) throw new Error(`Firestore Emulator fixture 실패 (${response.status()}): ${await response.text()}`);
}

export async function readFirestoreCollection(
  request: APIRequestContext,
  collection: string
): Promise<FirestoreDocument[]> {
  const response = await request.get(
    `${FIRESTORE_EMULATOR_ORIGIN}/v1/projects/${E2E_PROJECT_ID}`
      + `/databases/(default)/documents/${collection}`,
    {
      headers: {
        authorization: 'Bearer owner',
      },
    }
  );
  if (!response.ok()) {
    throw new Error(
      `Firestore Emulator ${collection} 조회 실패 `
        + `(${response.status()}): ${await response.text()}`
    );
  }
  const payload = await response.json() as { documents?: FirestoreDocument[] };
  return payload.documents ?? [];
}

export async function readExpenseDocuments(
  request: APIRequestContext
): Promise<FirestoreDocument[]> {
  return readFirestoreCollection(request, 'expenses');
}

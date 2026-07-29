import type { APIRequestContext } from '@playwright/test';

export const E2E_PROJECT_ID = 'demo-household-account-e2e';
export const E2E_EMAIL = 'playwright@household.test';
export const E2E_PASSWORD = 'playwright-password-1234';

const AUTH_EMULATOR_ORIGIN = 'http://127.0.0.1:9099';
const FIRESTORE_EMULATOR_ORIGIN = 'http://127.0.0.1:8080';

export interface FirestoreDocument {
  name: string;
  fields?: Record<string, {
    stringValue?: string;
    integerValue?: string;
    doubleValue?: number;
    booleanValue?: boolean;
  }>;
}

async function assertOk(response: Response, operation: string): Promise<void> {
  if (response.ok) return;
  throw new Error(`${operation} 실패 (${response.status}): ${await response.text()}`);
}

export async function resetEmulatorState(): Promise<void> {
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

import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { executeHouseholdCommand, readFirestoreCollection, type EmulatorAccount, type FirestoreValue, type FirestoreDocument, E2E_PROJECT_ID } from './emulator';

export interface PaymentActor extends EmulatorAccount { householdId: string; memberId: string }
export function decodeDocument(document: FirestoreDocument): Record<string, any> {
  const decode = (value: FirestoreValue): any => {
    if (value.stringValue !== undefined) return value.stringValue;
    if (value.integerValue !== undefined) return Number(value.integerValue);
    if (value.doubleValue !== undefined) return value.doubleValue;
    if (value.booleanValue !== undefined) return value.booleanValue;
    if (value.timestampValue !== undefined) return value.timestampValue;
    if (value.arrayValue) return (value.arrayValue.values ?? []).map(decode);
    if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, decode(item)]));
    return null;
  };
  return { id: document.name.split('/').at(-1)!, ...Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decode(value)])) };
}
export async function records(request: APIRequestContext, path: string) {
  return (await readFirestoreCollection(request, path)).map(decodeDocument);
}
export async function paymentCommand<T = Record<string, any>>(request: APIRequestContext, actor: PaymentActor, command: string, payload: unknown, commandId?: string): Promise<T> {
  return executeHouseholdCommand<T>(request, { idToken: actor.idToken, householdId: actor.householdId, command, payload, commandId });
}
export async function registerCard(request: APIRequestContext, actor: PaymentActor, cardLabel = '국민', cardLastFour = '') {
  return paymentCommand<{ cardId: string }>(request, actor, 'payment-configuration.register-card.v1', { card: { cardLabel, cardLastFour } });
}
export function rawNotification(input: { merchant?: string; amount?: number; card?: string; cancellation?: boolean; date?: string; time?: string } = {}) {
  const seoul = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
  const date = input.date ?? seoul.slice(0, 10);
  return {
    contractVersion: 'android-raw-notification.v1', observationId: `web-e2e-${randomUUID()}`,
    packageName: 'com.kbcard.cxh.appcard',
    notification: { postedAt: `${date}T23:59:59+09:00`, title: `KB국민카드${input.card ?? '1234'} ${input.cancellation ? '취소' : '승인'}`,
      textLines: [`${(input.amount ?? 12300).toLocaleString('en-US')}원 일시불`, `${date.slice(5, 7)}/${date.slice(8, 10)} ${input.time ?? '10:15'}`, input.merchant ?? 'E2E 커피점'] },
  };
}
export async function submitRaw(request: APIRequestContext, actor: PaymentActor | undefined, raw: unknown): Promise<any> {
  if (!E2E_PROJECT_ID.startsWith('demo-')) throw new Error('Capture E2E requires a demo Emulator project');
  // Firebase Functions Emulator의 skipTokenVerification 경로에만 제출하는
  // 외부 App Check attestation fixture입니다. 실제 Auth ID token은 그대로 사용합니다.
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const appCheck = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: '1:123456789:android:e2e', aud: [E2E_PROJECT_ID], exp: Math.floor(Date.now() / 1000) + 3600 })}.e2e`;
  const http = await request.post(`http://127.0.0.1:5001/${E2E_PROJECT_ID}/asia-northeast3/submitAndroidRawNotification`, {
    data: { data: raw }, headers: { ...(actor ? { authorization: `Bearer ${actor.idToken}` } : {}), 'X-Firebase-AppCheck': appCheck }, timeout: 30_000,
  });
  const wire = await http.json();
  if (!http.ok() || wire.error || wire.result === undefined) throw new Error(`submitAndroidRawNotification: ${http.status()} ${JSON.stringify(wire.error ?? {})}`);
  const response = wire.result;
  expect(response.contractVersion).toBe('capture-submission-response.v1');
  expect(response.result.completion).toBe('terminal');
  return response.result;
}
export async function issueShortcut(request: APIRequestContext, actor: PaymentActor) {
  const result = await paymentCommand(request, actor, 'shortcut.issue-credential.v1', {});
  expect(result.kind).toBe('issued');
  expect(result.rawCredential).toEqual(expect.any(String));
  return result;
}
export function shortcutMessage(input: { amount?: number; merchant?: string; cancellation?: boolean } = {}) {
  const date = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
  return `[Web발신]\n국민1234${input.cancellation ? '승인취소' : '승인'} 김*원\n${(input.amount ?? 12300).toLocaleString('en-US')}원 일시불\n${date.slice(5, 7)}/${date.slice(8, 10)} 00:01 ${input.merchant ?? 'Shortcut 카페'}`;
}
export async function submitShortcut(request: APIRequestContext, credential: string, message: unknown, key = `shortcut-e2e-${randomUUID()}`) {
  const response = await request.post(`http://127.0.0.1:5001/${E2E_PROJECT_ID}/asia-northeast3/addExpenseFromMessage`, {
    headers: { authorization: `Bearer ${credential}`, 'idempotency-key': key },
    data: { contractVersion: 'shortcut-payment.v1', message }, timeout: 30_000,
  });
  return { status: response.status(), body: await response.json(), headers: response.headers() };
}

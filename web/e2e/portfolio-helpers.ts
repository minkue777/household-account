import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { E2E_PROJECT_ID, firestoreFields, readFirestoreCollection, writeFirestoreFixture, type FirestoreDocument, type FirestoreValue } from './emulator';

function decode(value: FirestoreValue): unknown {
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.arrayValue) return (value.arrayValue.values ?? []).map(decode);
  if (value.mapValue) return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, decode(item)]));
  return null;
}
export function data(document: FirestoreDocument): Record<string, unknown> {
  return { id: document.name.split('/').at(-1)!, ...Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decode(value)])) };
}
export async function documents(request: APIRequestContext, collection: string): Promise<Record<string, unknown>[]> {
  return (await readFirestoreCollection(request, collection)).map(data);
}
/** 관리자 권한 REST는 과거 이력/공급자 상태라는 테스트 시작 조건만 준비합니다. */
export async function fixture(request: APIRequestContext, documentPath: string, value: Record<string, unknown>): Promise<void> {
  await writeFirestoreFixture(request, documentPath, firestoreFields(value));
}
export function modal(page: Page, title: string): Locator {
  return page.locator('div.fixed.inset-0').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).last();
}
export async function addAssetUi(page: Page, input: { name: string; type?: string; subType?: string; owner?: string; balance?: number; memo?: string; amount?: number; day?: number }): Promise<void> {
  await page.getByRole('button', { name: '추가', exact: true }).click();
  const dialog = modal(page, '자산 추가');
  if (input.type) await dialog.getByRole('button', { name: input.type, exact: true }).click();
  if (input.subType) await dialog.getByRole('button', { name: input.subType, exact: true }).click();
  if (input.owner) await dialog.getByRole('button', { name: input.owner, exact: true }).click();
  await dialog.locator('input').first().fill(input.name);
  if (input.balance !== undefined) await dialog.getByPlaceholder('0', { exact: true }).first().fill(String(input.balance));
  if (input.amount !== undefined) await dialog.getByPlaceholder('0', { exact: true }).nth(1).fill(String(input.amount));
  if (input.day !== undefined) await dialog.getByPlaceholder('예: 25').fill(String(input.day));
  if (input.memo) await dialog.getByPlaceholder('메모 입력').fill(input.memo);
  const saved = page.waitForResponse(response => response.url().endsWith('/executeHouseholdCommand')
    && response.request().method() === 'POST'
    && response.request().postDataJSON()?.data?.command === 'portfolio.create-asset.v1');
  await dialog.getByRole('button', { name: '추가', exact: true }).click();
  expect((await (await saved).json()).result.result.kind).toBe('succeeded');
  await expect(page.locator('[data-asset-id]').filter({ hasText: input.name })).toBeVisible();
}
/** 실제 exported Scheduler 함수의 run 경계부터 실제 Firestore Adapter까지 실행합니다.
 * Cloud Scheduler 전달만 대신하며 Domain/Repository/Provider를 mock하지 않습니다. */
export interface ProviderHttpFixture { urlIncludes: string; body: string; status?: number; headers?: Record<string, string> }
export async function runScheduled(name: 'assetAutomationDaily' | 'dividendHourly' | 'assetValuationDaily' | 'recurringDaily', scheduledFor: string, httpFixtures?: ProviderHttpFixture[]): Promise<string[]> {
  const module = { assetAutomationDaily: 'firebaseAssetAutomationScheduledJob', dividendHourly: 'firebaseDividendScheduledJob', assetValuationDaily: 'firebaseAssetValuationScheduledJob', recurringDaily: 'firebaseScheduledJobs' }[name];
  const entry = path.resolve(process.cwd(), '../functions/lib/bootstrap', `${module}.js`);
  const code = `const fixtures=JSON.parse(process.argv[4]);const urls=[];if(fixtures){const realFetch=globalThis.fetch;globalThis.fetch=async(url,init)=>{const target=new URL(String(url));if(target.hostname==='127.0.0.1'||target.hostname==='localhost')return realFetch(url,init);urls.push(target.href);const fixture=fixtures.find(item=>target.href.includes(item.urlIncludes));if(!fixture)throw new Error('UNEXPECTED_EXTERNAL_HTTP:'+target.href);return new Response(fixture.body,{status:fixture.status||200,headers:fixture.headers||{'content-type':'application/json'}});}}const job=require(process.argv[1])[process.argv[2]]; job.run({jobName:'e2e-scheduler',scheduleTime:process.argv[3],context:{eventId:'e2e-'+process.argv[2]+'-'+process.argv[3]}}).then(()=>{console.log('HTTP_E2E_RECORD:'+JSON.stringify(urls));process.exit(0)}).catch(error=>{console.error(error);process.exit(1)});`;
  const output = await promisify(execFile)(process.execPath, ['-e', code, entry, name, scheduledFor, JSON.stringify(httpFixtures ?? null)], {
    env: { ...process.env, DEBUG: '', GCLOUD_PROJECT: E2E_PROJECT_ID, GOOGLE_CLOUD_PROJECT: E2E_PROJECT_ID, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIREBASE_CONFIG: JSON.stringify({ projectId: E2E_PROJECT_ID }) },
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(output.stdout.split('\n').find(line => line.startsWith('HTTP_E2E_RECORD:'))!.slice('HTTP_E2E_RECORD:'.length)) as string[];
}

/** 운영 권한 부여 기능을 만들지 않고 Auth Emulator의 관리자 fixture API만 씁니다. */
export async function setEmulatorAdminClaims(uid: string): Promise<void> {
  const entry = path.resolve(process.cwd(), '../functions/package.json');
  const code = `const req=require('node:module').createRequire(process.argv[1]);const app=req('firebase-admin/app');app.initializeApp({projectId:process.env.GCLOUD_PROJECT});req('firebase-admin/auth').getAuth().setCustomUserClaims(process.argv[2],{systemAdmin:true}).then(()=>process.exit(0)).catch(error=>{console.error(error);process.exit(1)});`;
  await promisify(execFile)(process.execPath, ['-e', code, entry, uid], {
    env: { ...process.env, DEBUG: '', GCLOUD_PROJECT: E2E_PROJECT_ID, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }, timeout: 30_000,
  });
}

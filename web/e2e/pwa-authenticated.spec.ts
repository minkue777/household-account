import { expect, test, type Page } from '@playwright/test';
import { createHouseholdThroughUi, resetTestAccount } from './emulator';

test.beforeEach(async () => { await resetTestAccount(); });

async function cachedBuildAsset(page: Page, selected?: { cacheName: string; url: string }) {
  return page.evaluate(async selected => {
    const names = await caches.keys();
    const cacheName = selected?.cacheName ?? names.find(name => name.startsWith('household-static-v1-'));
    if (!cacheName || !names.includes(cacheName)) return null;
    const cache = await caches.open(cacheName);
    const url = selected?.url ?? (await cache.keys()).map(request => request.url)
      .find(value => /^\/_next\/static\/.*\.js$/.test(new URL(value).pathname));
    if (!url) return null;
    const response = await cache.match(url);
    if (!response) return null;
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    return { cacheName, url, status: response.status, byteLength: bytes.byteLength, sha256 };
  }, selected ?? null);
}

test('[T-PWA-006][PWA-001][PWA-002][PWA-003][PWA-008] 실제 로그인·홈 paint 뒤 자동 등록된 worker는 미저장 카테고리를 보존하고 사용자 폐기 승인 후 한 번 갱신한다', async ({ page }) => {
  await createHouseholdThroughUi(page);
  // 앱의 실제 first-ledger-paint와 지연 등록을 기다립니다. 이벤트/mark를 위조하지 않습니다.
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/'))?.active?.state), { timeout: 35_000 }).toBe('activated');
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');
  const before = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
  expect(before).toContain('/sw.js');
  await page.getByRole('link', { name: '설정', exact: true }).click();
  await page.getByRole('button', { name: /^카테고리\s*5개$/ }).click();
  await page.getByRole('button', { name: '생활비 수정', exact: true }).click();
  const input = page.getByPlaceholder('카테고리명', { exact: true });
  await input.fill('저장하지 않은 카테고리');
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js?candidate=authenticated-update', { scope: '/' }); });
  await expect(page.getByRole('status').filter({ hasText: '새 버전이 준비되었습니다.' })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(before);
  await expect(input).toHaveValue('저장하지 않은 카테고리');
  await page.getByRole('button', { name: '갱신', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: '작성 중인 입력이 있습니다', exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '계속 작성', exact: true }).click();
  await expect(input).toHaveValue('저장하지 않은 카테고리');
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(before);
  let reloads = 0;
  // Next의 같은 문서 history 갱신과 실제 새 문서 로딩을 구분합니다.
  page.on('request', request => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) reloads += 1;
  });
  await page.getByRole('button', { name: '갱신', exact: true }).click();
  await confirm.getByRole('button', { name: '입력 폐기 후 갱신', exact: true }).click();
  await expect(page.getByRole('heading', { name: '설정', exact: true })).toBeVisible();
  await expect(input).toHaveCount(0);
  expect(reloads).toBe(1);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('candidate=authenticated-update');
});

test('[PWA-003][PWA-004] 실제 로그아웃은 이전 runtime cache와 세션을 폐기하고 정적 build cache만 유지한다', async ({ page }) => {
  await createHouseholdThroughUi(page);
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/'))?.active?.state), { timeout: 35_000 }).toBe('activated');
  // 실제 Worker install이 저장한 JS를 선택합니다. 정적 cache를 직접 seed하지
  // 않고, 로그아웃 전후 같은 cache/key/응답 bytes가 유지되는지 확인합니다.
  await expect.poll(() => cachedBuildAsset(page)).not.toBeNull();
  const staticBefore = (await cachedBuildAsset(page))!;
  expect(staticBefore.status).toBe(200);
  expect(staticBefore.byteLength).toBeGreaterThan(0);
  // 전환 전 버전이 남긴 민감 runtime cache만 시작 조건으로 준비합니다.
  await page.evaluate(async () => {
    const old = await caches.open('old-household-runtime-cache');
    await old.put('/private-financial-response', new Response('synthetic finance'));
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('button', { name: '테스트 계정으로 로그인', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => caches.keys())).not.toContain('old-household-runtime-cache');
  expect(await cachedBuildAsset(page, staticBefore)).toEqual(staticBefore);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.filter(key => /signed-in-membership|session-generation/.test(key))).toEqual([]);
  await page.reload();
  await expect(page.getByRole('button', { name: '테스트 계정으로 로그인', exact: true })).toBeVisible();
});

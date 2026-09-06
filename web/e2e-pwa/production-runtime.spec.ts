import { expect, test } from '@playwright/test';

test('빌드된 HTML의 CSP가 hydration을 허용하고 실제 root worker가 static만 cache한다', async ({ page, context }) => {
  const blockedScripts: string[] = [];
  page.on('console', message => { if (/Refused to execute inline script|violates.*script-src/i.test(message.text())) blockedScripts.push(message.text()); });
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(response?.headers()['content-security-policy']).not.toContain("script-src 'unsafe-inline'");
  expect(response?.headers()['strict-transport-security']).toContain('max-age=31536000');
  await expect(page.getByRole('button', { name: /Google/ }).first()).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');
  await page.evaluate(async () => {
    await fetch('/icons/icon-192x192.png');
    await fetch('/?householdId=must-not-cache');
  });
  const readCachedUrls = () => page.evaluate(async () =>
    (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat()
  );
  await expect.poll(readCachedUrls).not.toEqual([]);
  const cachedUrls = await readCachedUrls();
  expect(cachedUrls.length).toBeGreaterThan(0);
  for (const value of cachedUrls) {
    const url = new URL(value);
    expect(url.pathname.startsWith('/_next/static/') || /^\/icons\/icon-\d+x\d+\.png$/.test(url.pathname)).toBe(true);
    expect(url.search).not.toContain('householdId');
  }
  expect(blockedScripts).toEqual([]);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map(registration => new URL(registration.scope).pathname))).toEqual(['/']);

  // A second worker script identity installs but keeps the existing client and controller.
  const before = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js?candidate=2', { scope: '/' }); });
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/'))?.waiting)).toBe(true);
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(before);
  const version = await page.evaluate(async () => {
    const waiting = (await navigator.serviceWorker.getRegistration('/'))!.waiting!;
    const channel = new MessageChannel();
    const response = new Promise<string>(resolve => { channel.port1.onmessage = event => resolve(event.data.workerVersion); });
    waiting.postMessage({ type: 'GET_WORKER_VERSION' }, [channel.port2]);
    return response;
  });
  expect(version).toBeTruthy();
  expect(context.serviceWorkers()).toHaveLength(2);
});

import { expect, test } from '@playwright/test';

test('[T-PWA-005][PWA-006][PWA-007] 알림 주소는 HTTP redirect로 편집 대상을 보존하고 CSP 차단 없이 화면을 연다', async ({ page, request }) => {
  const blockedScripts: string[] = [];
  const browserErrors: string[] = [];
  page.on('console', message => {
    if (/Refused to execute inline script|violates.*script-src|Executing inline script violates/i.test(message.text())) blockedScripts.push(message.text());
  });
  page.on('pageerror', error => browserErrors.push(error.message));

  for (const id of ['notification-route-probe', '한글/거래?수정#1&edit=other']) {
    const route = `/expenses/${encodeURIComponent(id)}/edit`;
    const redirect = await request.get(route, { maxRedirects: 0 });
    expect(redirect.status()).toBe(307);
    expect(redirect.headers()['cache-control']).toContain('no-store');
    const destination = new URL(redirect.headers().location, redirect.url());
    expect(destination.origin).toBe(new URL(redirect.url()).origin);
    expect(destination.pathname).toBe('/');
    expect(Array.from(destination.searchParams)).toEqual([['edit', id]]);
    expect(destination.hash).toBe('');
    expect(await redirect.text()).not.toContain('<script');

    // 로그인 복원 전에도 대상 ID를 잃거나 빈 화면에 멈추지 않아야 합니다.
    await page.goto(route);
    await expect(page.getByRole('button', { name: /\uB85C\uADF8\uC778/ }).first()).toBeVisible();
    expect(new URL(page.url()).searchParams.get('edit')).toBe(id);
  }
  expect(blockedScripts).toEqual([]);
  expect(browserErrors).toEqual([]);
});

test('[T-PWA-INSTALL-001][T-PWA-001][T-PWA-003][PWA-001][PWA-002][PWA-003][PWA-004][PWA-005][PWA-007][PWA-008] 빌드된 HTML의 CSP가 hydration을 허용하고 실제 root worker가 static만 cache한다', async ({ page, context, request }) => {
  const blockedScripts: string[] = [];
  page.on('console', message => { if (/Refused to execute inline script|violates.*script-src/i.test(message.text())) blockedScripts.push(message.text()); });
  const response = await page.goto('/');
  expect(response?.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(response?.headers()['content-security-policy']).not.toContain("script-src 'unsafe-inline'");
  expect(response?.headers()['strict-transport-security']).toContain('max-age=31536000');
  expect(response?.headers()['x-content-type-options']).toBe('nosniff');
  expect(response?.headers()['referrer-policy']).not.toBe('unsafe-url');
  expect(response?.headers()['permissions-policy']).toContain('camera=()');
  const manifest = await (await request.get('/manifest.json')).json();
  expect(manifest).toMatchObject({ start_url: '/', display: 'standalone', orientation: 'portrait' });
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect((await request.get('/firebase-messaging-sw.js')).status()).toBe(404);
  await expect(page.getByRole('button', { name: /\uB85C\uADF8\uC778/ }).first()).toBeVisible();
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      family: getComputedStyle(document.body).fontFamily,
      loaded: Array.from(document.fonts).filter(face => face.status === 'loaded').map(face => face.family),
      urls: performance.getEntriesByType('resource').map(entry => entry.name).filter(url => /\.(?:woff2?|ttf|otf)(?:\?|$)/i.test(url)),
    };
  });
  expect(fonts.family).toContain('Pretendard');
  expect(fonts.loaded).toContain('Pretendard Variable');
  expect(fonts.urls.length).toBeGreaterThan(0);
  expect(fonts.urls.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
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
  // 헤더 문자열 존재뿐 아니라 실제 브라우저가 임의 inline script 실행을 막는지 확인합니다.
  await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.__e2eUntrustedInlineExecuted = true;';
    document.head.appendChild(script);
  });
  await expect.poll(() => blockedScripts.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as typeof window & { __e2eUntrustedInlineExecuted?: boolean }).__e2eUntrustedInlineExecuted)).toBeUndefined();
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
  // Legacy Workbox 명령과 잘못된 버전은 활성화를 우회하지 못합니다.
  await page.evaluate(async () => {
    const waiting = (await navigator.serviceWorker.getRegistration('/'))!.waiting!;
    waiting.postMessage({ type: 'SKIP_WAITING' });
    waiting.postMessage({ type: 'ACTIVATE_WAITING_WORKER', workerVersion: 'wrong-build-version' });
    const channel = new MessageChannel();
    const ack = new Promise<void>(resolve => { channel.port1.onmessage = () => resolve(); });
    waiting.postMessage({ type: 'GET_WORKER_VERSION' }, [channel.port2]);
    await ack;
  });
  expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(before);
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/'))?.waiting)).toBe(true);
  // 실제 version handshake 뒤에만 새 Worker가 controller가 됩니다.
  await page.evaluate(async workerVersion => {
    (await navigator.serviceWorker.getRegistration('/'))!.waiting!.postMessage({ type: 'ACTIVATE_WAITING_WORKER', workerVersion });
  }, version);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('?candidate=2');
  await expect(page.getByRole('button', { name: /\uB85C\uADF8\uC778/ }).first()).toBeVisible();
});

import { expect, test } from '@playwright/test';
import { observeWorkerActivation } from './worker-activation-observer';
import { createServer, request as httpRequest, type ServerResponse } from 'node:http';

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

test('[T-PWA-006][T-PWA-002][PWA-004][PWA-008] 온라인 조회의 HTTP 응답을 기다리는 동안에도 새 worker로 갱신한다', async ({ page, baseURL }) => {
  // Serve the actual production build through a local proxy. Only this explicit
  // read is held by a real HTTP server; worker code/messages/clocks are unchanged.
  let heldResponse: ServerResponse | undefined;
  let received!: () => void;
  const requestReceived = new Promise<void>(resolve => { received = resolve; });
  const upstream = new URL(baseURL!);
  const server = createServer((request, response) => {
    if (request.url === '/__pwa_pending_read') {
      heldResponse = response;
      received();
      return;
    }
    const outgoing = httpRequest({ hostname: upstream.hostname, port: upstream.port,
      path: request.url, method: request.method, headers: request.headers }, incoming => {
      response.writeHead(incoming.statusCode!, incoming.headers);
      incoming.pipe(response);
    });
    outgoing.on('error', () => { response.writeHead(502); response.end(); });
    request.pipe(outgoing);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('PWA proxy did not bind a port');
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    await page.goto(origin);
    await expect(page.getByRole('button', { name: /\uB85C\uADF8\uC778/ }).first()).toBeVisible();
    await page.evaluate(async () => {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(`${origin}/sw.js`);
    const pendingRead = await page.evaluateHandle(() => {
      const result = { settled: false, body: '' };
      void fetch('/__pwa_pending_read').then(response => response.text()).then(body => {
        result.body = body;
        result.settled = true;
      });
      return result;
    });
    await requestReceived;
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js?pending-read-update=1', { scope: '/' }); });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/'))?.waiting?.state)).toBe('installed');
    await page.evaluate(async () => {
      const waiting = (await navigator.serviceWorker.getRegistration('/'))!.waiting!;
      const channel = new MessageChannel();
      const version = await new Promise<string>(resolve => {
        channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data.workerVersion); };
        waiting.postMessage({ type: 'GET_WORKER_VERSION' }, [channel.port2]);
      });
      waiting.postMessage({ type: 'ACTIVATE_WAITING_WORKER', workerVersion: version });
    });
    await expect.poll(() => page.evaluate(async () => {
      const registration = (await navigator.serviceWorker.getRegistration('/'))!;
      return { controller: navigator.serviceWorker.controller?.scriptURL,
        active: registration.active?.scriptURL, state: registration.active?.state };
    })).toEqual({ controller: `${origin}/sw.js?pending-read-update=1`,
      active: `${origin}/sw.js?pending-read-update=1`, state: 'activated' });
    expect(heldResponse?.writableEnded).toBe(false);
    expect(await pendingRead.evaluate(result => result.settled)).toBe(false);
    heldResponse!.writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
    heldResponse!.end('online response after worker update');
    await expect.poll(() => pendingRead.evaluate(result => result.body)).toBe('online response after worker update');
    const cachedPaths = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async name =>
      (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)))).flat());
    expect(cachedPaths).not.toContain('/__pwa_pending_read');
    await pendingRead.dispose();
  } finally {
    heldResponse?.end();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('[T-PWA-INSTALL-001][T-PWA-001][T-PWA-003][PWA-001][PWA-002][PWA-003][PWA-004][PWA-005][PWA-007][PWA-008] 빌드된 HTML의 CSP가 hydration을 허용하고 실제 root worker가 static만 cache한다', async ({ page, context, request }, testInfo) => {
  const workerObservation = observeWorkerActivation(context);
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
  await workerObservation.ready();
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

  // Observe the real registration lifecycle without replacing workers, messages or clocks.
  const lifecycle = await page.evaluateHandle(async () => {
    const registration = (await navigator.serviceWorker.getRegistration('/'))!;
    const describe = (worker: ServiceWorker | null) => worker
      ? { scriptURL: worker.scriptURL, state: worker.state } : null;
    const current = () => ({ controller: describe(navigator.serviceWorker.controller),
      active: describe(registration.active), waiting: describe(registration.waiting), installing: describe(registration.installing) });
    const events: Array<{ reason: string; atMs: number; state: ReturnType<typeof current> }> = [];
    const record = (reason: string) => {
      events.push({ reason, atMs: performance.now(), state: current() });
      if (events.length > 30) events.shift();
    };
    const watched = new Map<ServiceWorker, () => void>();
    const discover = () => {
      for (const worker of [registration.active, registration.waiting, registration.installing]) {
        if (!worker || watched.has(worker)) continue;
        const changed = () => record(worker.scriptURL + ':' + worker.state);
        watched.set(worker, changed); worker.addEventListener('statechange', changed);
      }
      record('registration');
    };
    const controllerChanged = () => record('controllerchange');
    registration.addEventListener('updatefound', discover);
    navigator.serviceWorker.addEventListener('controllerchange', controllerChanged);
    discover();
    return { read: () => ({ current: current(), events }), dispose: () => {
      registration.removeEventListener('updatefound', discover);
      navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged);
      watched.forEach((listener, worker) => worker.removeEventListener('statechange', listener));
    } };
  });
  try {
    // A second worker script identity installs but keeps the existing client and controller.
    const before = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
    const candidateUrl = new URL('/sw.js?candidate=2', page.url()).href;
    await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js?candidate=2', { scope: '/' }); });
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration('/'))?.waiting)).toBe(true);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration('/'))?.waiting?.scriptURL)).toBe(candidateUrl);
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(before);
    await workerObservation.ready();
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
    // Keep the same 15-second activation deadline, and include the active/waiting states on failure.
    await expect.poll(() => lifecycle.evaluate(probe => probe.read())).toMatchObject({ current: {
      controller: { scriptURL: candidateUrl, state: 'activated' },
      active: { scriptURL: candidateUrl, state: 'activated' },
    } });
    const candidateObservation = (await workerObservation.read()).find(value => value.url === candidateUrl);
    expect(candidateObservation).toMatchObject({ events: expect.arrayContaining([
      expect.objectContaining({ type: 'message', messageType: 'ACTIVATE_WAITING_WORKER', workerVersion: version }),
      expect.objectContaining({ type: 'skipWaiting' }),
      expect.objectContaining({ type: 'skipWaiting-resolved' }),
    ]) });
    await expect(page.getByRole('button', { name: /\uB85C\uADF8\uC778/ }).first()).toBeVisible();
  } finally {
    await testInfo.attach('worker-activation-events', { contentType: 'application/json', body: Buffer.from(JSON.stringify(await workerObservation.read(), null, 2)) });
    await workerObservation.dispose();
    await testInfo.attach('worker-activation-lifecycle', { contentType: 'application/json',
      body: Buffer.from(JSON.stringify(await lifecycle.evaluate(probe => probe.read()), null, 2)) });
    await lifecycle.evaluate(probe => probe.dispose());
    await lifecycle.dispose();
  }
});

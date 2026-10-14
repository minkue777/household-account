import { expect, test } from '@playwright/test';
import { launchRawChromium } from './raw-chromium';

test('[T-PWA-006][PWA-008] 갱신 직후 정적 요청이 겹쳐도 문서를 보존하고 자연 교체한다', async ({ baseURL }, testInfo) => {
  test.setTimeout(75000);
  const browser = await launchRawChromium();
  const candidateUrl = new URL('/sw.js?static-request-race=1', baseURL).href;
  const readState = `(() => {
    const probe = window.__activationRace;
    if (!probe) return { documentPreserved: false };
    return { documentPreserved: performance.timeOrigin === probe.timeOrigin,
      controllerIsCandidate: navigator.serviceWorker.controller === probe.candidate,
      activeIsCandidate: probe.registration.active === probe.candidate,
      state: probe.candidate.state, requests: probe.requests,
      elapsedMs: performance.now() - probe.startedAt };
  })()`;
  try {
    await browser.send('Page.navigate', { url: baseURL });
    const settled = () => browser.evaluate(`document.readyState === 'complete' &&
      Array.from(document.querySelectorAll('button')).some(button => /로그인/.test(button.textContent))`);
    await expect.poll(settled).toBe(true);
    await browser.evaluate(`(async () => {
      await document.fonts.ready;
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
    })()`);
    await browser.send('Page.reload');
    await expect.poll(settled).toBe(true);
    await browser.evaluate(`document.fonts.ready.then(() => true)`);
    await expect.poll(() => browser.evaluate(`navigator.serviceWorker.controller?.scriptURL`)).toBe(new URL('/sw.js', baseURL).href);
    await browser.evaluate(`navigator.serviceWorker.register(${JSON.stringify(candidateUrl)}, { scope: '/' }).then(() => true)`);
    await expect.poll(() => browser.evaluate(`navigator.serviceWorker.getRegistration('/').then(registration => registration.waiting?.state)`)).toBe('installed');
    await browser.evaluate(`(async () => {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const candidate = registration.waiting;
      if (candidate.scriptURL !== ${JSON.stringify(candidateUrl)}) throw new Error('Unexpected waiting worker');
      const channel = new MessageChannel();
      const version = await new Promise(resolve => {
        channel.port1.onmessage = event => { channel.port1.close(); resolve(event.data.workerVersion); };
        candidate.postMessage({ type: 'GET_WORKER_VERSION' }, [channel.port2]);
      });
      if (!version || candidate === navigator.serviceWorker.controller) throw new Error('Missing distinct waiting candidate');
      window.__activationRace = { registration, candidate, version,
        oldController: navigator.serviceWorker.controller, timeOrigin: performance.timeOrigin, requests: [] };
    })()`);
    const original = browser.events.flatMap(event => event.versions).findLast(version =>
      version.scriptURL === new URL('/sw.js', baseURL).href && version.status === 'activated');
    expect(original, 'The browser must observe the real original worker').toBeDefined();
    const initial = await browser.evaluate(`(() => {
      const probe = window.__activationRace;
      probe.startedAt = performance.now();
      probe.candidate.postMessage({ type: 'ACTIVATE_WAITING_WORKER', workerVersion: probe.version });
      // Real requests overlap native worker shutdown; worker code and clocks stay unchanged.
      for (let offset = 0; offset <= 34; offset++) setTimeout(() => {
        const request = { startedAt: performance.now() };
        probe.requests.push(request);
        fetch('/icons/icon-192x192.png').then(async response => {
          request.status = response.status;
          request.bytes = (await response.arrayBuffer()).byteLength;
        }, error => { request.error = String(error); });
      }, offset);
      return { controllerIsOld: navigator.serviceWorker.controller === probe.oldController,
        waitingIsCandidate: probe.registration.waiting === probe.candidate, state: probe.candidate.state };
    })()`);
    expect(initial).toEqual({ controllerIsOld: true, waitingIsCandidate: true, state: 'installed' });
    await expect.poll(() => browser.evaluate(readState), { timeout: 45000 }).toMatchObject({
      documentPreserved: true, controllerIsCandidate: true, activeIsCandidate: true, state: 'activated',
    });
    const result = await browser.evaluate<{ elapsedMs: number; requests: Array<{ status: number; bytes: number }> }>(readState);
    expect(result.elapsedMs).toBeLessThanOrEqual(45000);
    expect(result.requests).toHaveLength(35);
    for (const request of result.requests) {
      expect(request.status).toBe(200);
      expect(request.bytes).toBeGreaterThan(0);
    }
    await expect.poll(settled).toBe(true);
  } finally {
    try {
      await testInfo.attach('raw-worker-race', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
        workerVersions: browser.events,
        page: await browser.evaluate(readState).catch(error => ({ error: String(error) })),
      }, null, 2)) });
    } finally {
      await browser.close();
    }
  }
});

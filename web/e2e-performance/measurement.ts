import { expect, type Page, type TestInfo } from '@playwright/test';

export interface MeasurementOptions {
  id: string;
  label: string;
  iteration: number;
  warmup: boolean;
  cacheState: string;
  action: () => Promise<void>;
  ready: () => Promise<void>;
  browserReady: (data: any) => boolean;
  data?: any;
  navigation?: boolean;
  startEvent?: 'click' | 'input';
  charts?: boolean;
  chartIndexes?: number[];
  command?: boolean;
  commandName?: string;
}

const installed = new WeakSet<Page>();

// This observer is installed only by Playwright. It does not change application responses,
// clocks, animations, persistence, or production telemetry.
function installBrowserProbe() {
  const root = window as any;
  if (root.__householdPerformance) return;
  const drawn = new WeakMap<HTMLCanvasElement, number>();
  const prototype = CanvasRenderingContext2D.prototype as any;
  for (const method of ['clearRect', 'fillRect', 'strokeRect', 'fill', 'stroke', 'drawImage', 'fillText', 'strokeText']) {
    const original = prototype[method];
    prototype[method] = function (...args: unknown[]) {
      const result = original.apply(this, args);
      drawn.set(this.canvas, performance.now());
      return result;
    };
  }
  root.__householdPerformance = { drawn };
}

function armBrowserProbe(config: any, predicate: (data: any) => boolean) {
  const runtime = (window as any).__householdPerformance;
  runtime.cancel?.();
  let startAt: number | undefined = config.navigation ? 0 : undefined;
  let frame: number | undefined;
  let readySince: number | undefined;
  let candidatePaint: number | undefined;
  let candidateDraw = -1;
  let settledFrames = 0;
  let completed = false;
  let resolveResult: (value: any) => void;
  runtime.result = new Promise(resolve => { resolveResult = resolve; });
  const finish = (value: any) => {
    if (completed) return;
    completed = true;
    cleanup();
    resolveResult(value);
  };
  const begin = (event: Event) => {
    if (!event.isTrusted || startAt !== undefined) return;
    startAt = performance.now();
    runtime.startAt = startAt;
    frame = requestAnimationFrame(tick);
  };
  const tick = () => {
    if (completed || startAt === undefined) return;
    let ready = false;
    try { ready = predicate(config.data); } catch { /* DOM may not exist during navigation. */ }
    if (!ready) {
      readySince = undefined;
      candidatePaint = undefined;
      settledFrames = 0;
    } else {
      readySince ??= performance.now();
      let lastDraw = 0;
      let chartsFresh = true;
      if (config.charts) {
        const canvases = Array.from(document.querySelectorAll('canvas'));
        const relevant = config.chartIndexes ? config.chartIndexes.map((index: number) => canvases[index]) : canvases;
        chartsFresh = relevant.length > 0;
        for (const canvas of relevant) {
          if (!canvas) { chartsFresh = false; continue; }
          const rect = canvas.getBoundingClientRect();
          const draw = runtime.drawn.get(canvas) ?? 0;
          if (rect.width <= 0 || rect.height <= 0 || draw < startAt) chartsFresh = false;
          lastDraw = Math.max(lastDraw, draw);
        }
      }
      if (!config.charts || chartsFresh) {
        if (candidatePaint === undefined || lastDraw !== candidateDraw) {
          candidateDraw = lastDraw;
          candidatePaint = performance.now();
          settledFrames = 0;
        } else {
          settledFrames += 1;
          if (settledFrames === 1) candidatePaint = performance.now();
          // Observe 100 ms of chart quiescence but report the candidate paint, not
          // the observation delay. This is a drawing proxy, not physical screen timing.
          if (settledFrames >= 2 && (!config.charts || performance.now() - Math.max(lastDraw, readySince) >= 100)) {
            finish({ startAt, endAt: candidatePaint, durationMs: candidatePaint - startAt });
            return;
          }
        }
      }
    }
    frame = requestAnimationFrame(tick);
  };
  const cleanup = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    clearTimeout(timer);
    document.removeEventListener(config.startEvent, begin, true);
  };
  const timer = window.setTimeout(() => finish({ error: 'PERFORMANCE_READY_TIMEOUT', startAt }), 30_000);
  runtime.startAt = startAt;
  runtime.cancel = () => finish({ error: 'PERFORMANCE_CANCELLED' });
  if (config.navigation) frame = requestAnimationFrame(tick);
  else document.addEventListener(config.startEvent, begin, true);
}

export async function installMeasurement(page: Page): Promise<void> {
  if (installed.has(page)) return;
  await page.addInitScript(installBrowserProbe);
  await page.evaluate(installBrowserProbe);
  installed.add(page);
}

async function attach(testInfo: TestInfo, options: MeasurementOptions, durationMs: number, suffix = '', labelSuffix = '') {
  expect(Number.isFinite(durationMs) && durationMs >= 0, options.id).toBe(true);
  await testInfo.attach('performance-sample', {
    contentType: 'application/json',
    body: JSON.stringify({ metric: options.id + suffix, label: options.label + labelSuffix,
      project: testInfo.project.name, iteration: options.iteration, warmup: options.warmup,
      cacheState: options.cacheState, durationMs,
      completion: suffix ? 'successful-callable-response-body' : options.charts ? 'correct-dom-and-canvas-drawing-quiescence' : 'correct-dom-paint-observation' }),
  });
}

export async function measure(page: Page, testInfo: TestInfo, options: MeasurementOptions): Promise<number> {
  await installMeasurement(page);
  const config = { navigation: options.navigation ?? false, startEvent: options.startEvent ?? 'click',
    charts: options.charts ?? false, chartIndexes: options.chartIndexes, data: options.data };
  const source = `(${installBrowserProbe.toString()})();(${armBrowserProbe.toString()})(${JSON.stringify(config)},(${options.browserReady.toString()}))`;
  // Navigation observers are enabled for exactly the next document by sessionStorage.
  // Persistent init scripts must not arm old predicates on subsequent navigations.
  if (options.navigation) {
    const key = `performance-navigation-${testInfo.project.name}-${options.id}-${options.iteration}`;
    await page.addInitScript({ content: `if(!sessionStorage.getItem(${JSON.stringify(key)})){sessionStorage.setItem(${JSON.stringify(key)},'consumed');${source}}` });
  } else await page.evaluate(source);

  if (options.command && !options.commandName) throw new Error('PERFORMANCE_COMMAND_NAME_REQUIRED');
  const responsePromise = options.command ? page.waitForResponse(async response => {
    if (!response.url().includes('/executeHouseholdCommand')) return false;
    try {
      const request = response.request();
      const envelope = request.postDataJSON()?.data;
      if (envelope?.command !== options.commandName || typeof envelope.commandId !== 'string') return false;
      const clock = await page.evaluate(() => ({ origin: performance.timeOrigin, start: (window as any).__householdPerformance.startAt }));
      return typeof clock.start === 'number' && request.timing().startTime >= clock.origin + clock.start - 1;
    }
    catch { return false; }
  }, { timeout: 30_000 }) : undefined;
  // Attach rejection immediately while UI work is in progress.
  const commandResult = responsePromise?.then(async response => {
    const body = await response.json();
    expect(response.ok()).toBe(true);
    expect(body.result?.result?.kind, JSON.stringify(body)).toBe('succeeded');
    await response.finished();
    const timing = response.request().timing();
    const clock = await page.evaluate(() => ({ origin: performance.timeOrigin, start: (window as any).__householdPerformance.startAt }));
    expect(timing.responseEnd).toBeGreaterThanOrEqual(0);
    return timing.startTime + timing.responseEnd - clock.origin - clock.start;
  }).then(value => ({ value }), error => ({ error }));

  await options.action();
  const result = await page.evaluate(() => (window as any).__householdPerformance.result);
  expect(result?.error, `${options.id}: ${JSON.stringify(result)}`).toBeUndefined();
  await options.ready();
  await attach(testInfo, options, result.durationMs);
  if (commandResult) {
    const outcome = await commandResult;
    if ('error' in outcome) throw outcome.error;
    await attach(testInfo, options, outcome.value, '.server-confirmed', ' — 서버 저장 확정');
  }
  return result.durationMs;
}

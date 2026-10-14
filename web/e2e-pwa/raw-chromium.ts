import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export type WorkerVersion = { versionId: string; scriptURL: string; status: string; runningStatus: string };
type ProtocolMessage = {
  id?: number;
  method?: string;
  params?: { versions?: WorkerVersion[] };
  result?: unknown;
  error?: { message: string };
};

// Playwright attaches to service-worker targets and changes Chromium's idle
// termination. This connection observes the page only, without worker debugging.
export async function launchRawChromium() {
  const profile = await mkdtemp(path.join(tmpdir(), 'household-pwa-race-'));
  const browserProcess = spawn(chromium.executablePath(), [
    '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    // Match Playwright's Chromium launch defaults on CI Linux.
    '--no-sandbox', '--disable-dev-shm-usage',
    '--disable-background-networking', '--disable-extensions', 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  let socket: WebSocket | undefined;
  let sequence = 0;
  const pending = new Map<number, {
    resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout;
  }>();
  const events: Array<{ atMs: number; versions: WorkerVersion[] }> = [];
  const send = <T = unknown>(method: string, params: object = {}): Promise<T> => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve: value => resolve(value as T), reject, timer });
    socket!.send(JSON.stringify({ id, method, params }));
  });
  const close = async () => {
    if (socket?.readyState === WebSocket.OPEN) {
      // Closing the browser may close CDP before its response arrives.
      socket.send(JSON.stringify({ id: ++sequence, method: 'Browser.close' }));
    }
    if (browserProcess.exitCode === null) {
      await Promise.race([once(browserProcess, 'exit'), delay(3000)]);
      if (browserProcess.exitCode === null) {
        browserProcess.kill();
        await Promise.race([once(browserProcess, 'exit'), delay(3000)]);
      }
    }
    socket?.close();
    for (const request of Array.from(pending.values())) {
      clearTimeout(request.timer);
      request.reject(new Error('Raw Chromium closed'));
    }
    pending.clear();
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(profile));
    if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.startsWith('household-pwa-race-')) {
      throw new Error('Refusing to remove an unexpected Chromium profile');
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  };
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Chromium startup timeout: ${stderr}`)), 15000);
      const finish = (error?: Error, value?: string) => {
        clearTimeout(timer);
        if (error) reject(error); else resolve(value!);
      };
      browserProcess.once('error', error => finish(error));
      browserProcess.once('exit', code => finish(new Error(`Chromium exited: ${code}; ${stderr}`)));
      browserProcess.stderr.on('data', data => {
        stderr += data.toString();
        const value = stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
        if (value) finish(undefined, value);
      });
    });
    const address = new URL(endpoint);
    const target = await (await fetch(`http://${address.host}/json/new?about:blank`, { method: 'PUT' })).json() as { webSocketDebuggerUrl: string };
    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener('open', () => resolve(), { once: true });
      socket!.addEventListener('error', () => reject(new Error('Chromium page connection failed')), { once: true });
    });
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data)) as ProtocolMessage;
      if (message.id) {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(message.error.message));
        else request.resolve(message.result);
      } else if (message.method === 'ServiceWorker.workerVersionUpdated') {
        events.push({ atMs: performance.now(), versions: message.params!.versions! });
      }
    });
    await send('Page.enable');
    await send('ServiceWorker.enable');
    return {
      send, events, close,
      async evaluate<T>(expression: string): Promise<T> {
        const result = await send<{ result: { value: T }; exceptionDetails?: unknown }>('Runtime.evaluate', {
          expression, awaitPromise: true, returnByValue: true,
        });
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

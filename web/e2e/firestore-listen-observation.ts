import type { Page } from '@playwright/test';

interface ListenResponseObservation {
  entries: Record<string, string | number | number[] | undefined>[];
  receivedCharacters: number;
  parsedFrames: number;
  parseErrors: number;
  truncated: boolean;
}

/** SDK에 전달하는 응답을 그대로 두고 완료 전 Listen chunk의 허용된 필드만 관찰합니다. */
export async function observeFirestoreListenResponses(page: Page) {
  await page.addInitScript(() => {
    type Entry = Record<string, string | number | number[] | undefined>;
    const runtime = window as typeof window & {
      e2eHomeListen?: { read: () => unknown; stop: () => void };
    };
    const entries: Entry[] = [];
    const cleanups = new Set<() => void>();
    const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>();
    let stopped = false;
    let truncated = false;
    let receivedCharacters = 0;
    let parsedFrames = 0;
    let parseErrors = 0;
    let streamId = 0;
    const record = (entry: Entry) => {
      if (stopped) return;
      if (entries.length >= 2_000) { truncated = true; return; }
      entries.push({ receivedAt: Date.now(), ...entry });
    };
    const targetIds = (value: unknown): number[] => Array.isArray(value)
      ? value.filter((id): id is number => Number.isSafeInteger(id)).slice(0, 30) : [];
    const inspect = (value: unknown, id: number): void => {
      if (Array.isArray(value)) { value.forEach(item => inspect(item, id)); return; }
      if (typeof value !== 'object' || value === null) return;
      const event = value as Record<string, any>;
      const change = event.targetChange;
      if (change && ['NO_CHANGE', 'ADD', 'REMOVE', 'CURRENT', 'RESET'].includes(change.targetChangeType ?? 'NO_CHANGE')) {
        record({ streamId: id, kind: 'targetChange', change: change.targetChangeType ?? 'NO_CHANGE',
          targetIds: targetIds(change.targetIds), causeCode: Number.isInteger(change.cause?.code) ? change.cause.code : undefined });
      }
      for (const kind of ['documentChange', 'documentDelete', 'documentRemove'] as const) {
        const changed = event[kind];
        const document = changed?.document;
        const name = typeof document === 'string' ? document : document?.name;
        if (typeof name !== 'string' || !/^projects\/demo-household-account-e2e\/databases\/\(default\)\/documents\/households\/[^/]+\/homePreferences\/home$/.test(name)) continue;
        const fields = typeof document === 'object' ? document.fields : undefined;
        const card = (field: any) => ['YEARLY_EXPENSE', 'MONTHLY_EXPENSE', 'MONTHLY_REMAINING_BUDGET', 'LOCAL_CURRENCY_BALANCE']
          .includes(field?.stringValue) ? field.stringValue as string : undefined;
        const version = Number(fields?.aggregateVersion?.integerValue);
        record({ streamId: id, kind, householdId: name.split('/')[6], targetIds: targetIds(changed.targetIds),
          removedTargetIds: targetIds(changed.removedTargetIds), left: card(fields?.left), right: card(fields?.right),
          aggregateVersion: Number.isSafeInteger(version) ? version : undefined });
      }
    };
    const parser = (transport: string) => {
      const id = ++streamId;
      record({ streamId: id, kind: 'stream', transport });
      let pending = '';
      let disabled = false;
      return (text: string) => {
        if (stopped || disabled || !text) return;
        receivedCharacters += text.length;
        if (receivedCharacters > 4_000_000 || pending.length + text.length > 256_000) {
          truncated = true; disabled = true; pending = ''; return;
        }
        pending += text;
        while (pending) {
          const newline = pending.indexOf('\n');
          if (newline < 0) return;
          const length = Number(pending.slice(0, newline));
          if (!Number.isSafeInteger(length) || length < 0 || length > 256_000) {
            parseErrors += 1; disabled = true; pending = ''; return;
          }
          if (pending.length < newline + 1 + length) return;
          const frame = pending.slice(newline + 1, newline + 1 + length);
          pending = pending.slice(newline + 1 + length);
          try { inspect(JSON.parse(frame), id); parsedFrames += 1; } catch { parseErrors += 1; }
        }
      };
    };
    const isListen = (url: string) => {
      try { return new URL(url, location.href).pathname.endsWith('/google.firestore.v1.Firestore/Listen/channel'); }
      catch { return false; }
    };
    const originalFetch = window.fetch;
    const observedFetch: typeof fetch = async (...args) => {
      const response = await Reflect.apply(originalFetch, window, args);
      const input = args[0];
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!stopped && isListen(url)) {
        try {
          const reader = response.clone().body?.getReader();
          if (reader) {
            readers.add(reader);
            const feed = parser('fetch');
            void (async () => {
              const decoder = new TextDecoder();
              try {
                while (!stopped) {
                  const chunk = await reader.read();
                  if (chunk.done) { feed(decoder.decode()); break; }
                  feed(decoder.decode(chunk.value, { stream: true }));
                }
              } catch { /* SDK의 원래 응답·오류 흐름을 바꾸지 않습니다. */ }
              finally { readers.delete(reader); reader.releaseLock(); }
            })();
          }
        } catch { /* 복제 불가능한 응답도 그대로 SDK에 돌려줍니다. */ }
      }
      return response;
    };
    window.fetch = observedFetch;
    const originalOpen = XMLHttpRequest.prototype.open;
    const observedOpen = function (this: XMLHttpRequest, ...args: Parameters<typeof originalOpen>) {
      const result = Reflect.apply(originalOpen, this, args);
      if (!stopped && isListen(String(args[1]))) {
        const feed = parser('xhr');
        let offset = 0;
        const observe = () => {
          try {
            if (this.responseType !== '' && this.responseType !== 'text') return;
            const text = this.responseText;
            feed(text.slice(offset)); offset = text.length;
          } catch { /* 아직 읽을 수 없는 상태는 다음 실제 progress에서 확인합니다. */ }
        };
        const cleanup = () => {
          this.removeEventListener('progress', observe);
          this.removeEventListener('readystatechange', observe);
          this.removeEventListener('loadend', complete);
          cleanups.delete(cleanup);
        };
        const complete = () => { observe(); cleanup(); };
        this.addEventListener('progress', observe);
        this.addEventListener('readystatechange', observe);
        this.addEventListener('loadend', complete);
        cleanups.add(cleanup);
      }
      return result;
    } as typeof originalOpen;
    XMLHttpRequest.prototype.open = observedOpen;
    const stop = () => {
      stopped = true;
      if (window.fetch === observedFetch) window.fetch = originalFetch;
      if (XMLHttpRequest.prototype.open === observedOpen) XMLHttpRequest.prototype.open = originalOpen;
      cleanups.forEach(cleanup => cleanup());
      readers.forEach(reader => { void reader.cancel().catch(() => {}); });
      window.removeEventListener('pagehide', stop);
    };
    runtime.e2eHomeListen = { read: () => ({ entries, receivedCharacters, parsedFrames, parseErrors, truncated }), stop };
    window.addEventListener('pagehide', stop, { once: true });
  });
  return {
    read: () => page.evaluate(() => (window as typeof window & { e2eHomeListen?: { read: () => ListenResponseObservation } }).e2eHomeListen?.read()),
    stop: () => page.evaluate(() => (window as typeof window & { e2eHomeListen?: { stop: () => void } }).e2eHomeListen?.stop()),
  };
}

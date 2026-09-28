import http from 'node:http';

const MAX_BODY_BYTES = 1024 * 1024;
const CALLABLE_PATH = /^\/demo-household-account-e2e\/asia-northeast3\/[A-Za-z][A-Za-z0-9_-]*$/;
const COMMAND_PATH = '/demo-household-account-e2e/asia-northeast3/executeHouseholdCommand';
const CONTROL_PATH = '/__quickedit_gate/';
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);

function headersWithoutHopHeaders(headers) {
  const excluded = new Set([...HOP_HEADERS, ...(headers.connection ?? '').split(',').map(value => value.trim().toLowerCase())]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !excluded.has(key)));
}

function reply(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  if (response.headersSent) { response.destroy(); return; }
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let length = 0;
    const chunks = [];
    request.on('data', chunk => {
      length += chunk.length;
      if (length > MAX_BODY_BYTES) {
        chunks.length = 0;
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
      } else {
        chunks.push(chunk);
      }
    });
    request.once('end', () => resolve(Buffer.concat(chunks)));
    request.once('error', reject);
    request.once('aborted', () => reject(new Error('Request aborted')));
  });
}

/** Loopback-only transport gate. All domain responses come from the real emulator. */
export async function startNativeCommandGate({ port = 5002, upstreamPort = 5001, holdTimeoutMs = 120_000, upstreamTimeoutMs = 30_000 } = {}) {
  for (const value of [port, upstreamPort]) {
    if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error('Invalid loopback port');
  }
  for (const value of [holdTimeoutMs, upstreamTimeoutMs]) {
    if (!Number.isInteger(value) || value <= 0 || value > 2_147_483_647) throw new Error('Invalid gate timeout');
  }
  let targetTransactionId;
  let targetConsumed = false;
  let held;
  let holdTimer;
  let trackedUpstream;
  let inFlight = false;
  let forwarded = 0;
  let completed = false;
  let stopping = false;
  let stopPromise;
  const sockets = new Set();
  const upstreamRequests = new Set();

  function forward(pending, tracked = false) {
    if (stopping || pending.response.destroyed || pending.response.writableEnded) return false;
    if (tracked) { inFlight = true; forwarded += 1; }
    const headers = headersWithoutHopHeaders(pending.headers);
    headers.host = `127.0.0.1:${upstreamPort}`;
    headers['content-length'] = String(pending.body.length);
    const upstream = http.request({
      hostname: '127.0.0.1', port: upstreamPort, path: pending.path,
      method: pending.method, headers,
    }, response => {
      if (pending.response.destroyed || pending.response.writableEnded) { response.destroy(); return; }
      pending.response.writeHead(response.statusCode, headersWithoutHopHeaders(response.headers));
      response.pipe(pending.response);
      response.once('end', () => {
        if (trackedUpstream === upstream) {
          completed = true; inFlight = false; targetTransactionId = undefined; trackedUpstream = undefined;
        }
      });
      response.once('error', () => {
        if (trackedUpstream === upstream) inFlight = false;
        pending.response.destroy();
      });
    });
    if (tracked) trackedUpstream = upstream;
    const deadline = setTimeout(() => {
      reply(pending.response, 504, { error: 'Loopback upstream timed out' });
      upstream.destroy();
    }, upstreamTimeoutMs);
    deadline.unref();
    const downstreamClosed = () => {
      if (!pending.response.writableFinished) upstream.destroy();
    };
    pending.response.once('close', downstreamClosed);
    upstreamRequests.add(upstream);
    upstream.once('close', () => {
      clearTimeout(deadline);
      pending.response.off('close', downstreamClosed);
      upstreamRequests.delete(upstream);
      if (trackedUpstream === upstream) { inFlight = false; trackedUpstream = undefined; }
    });
    upstream.once('error', () => {
      if (trackedUpstream === upstream) inFlight = false;
      reply(pending.response, 502, { error: 'Loopback upstream unavailable' });
    });
    upstream.end(pending.body);
    return true;
  }

  const server = http.createServer(async (request, response) => {
    try {
      if (stopping) return reply(response, 503, { error: 'Gate stopping' });
      if (!request.url.startsWith('/') || request.url.startsWith('//')) return reply(response, 400, { error: 'Invalid local path' });
      const url = new URL(request.url, 'http://127.0.0.1');
      const control = url.pathname.startsWith(CONTROL_PATH);
      // Do not accept configurable hosts, projects, regions or URL normalization escapes.
      if (!control && (!CALLABLE_PATH.test(url.pathname) || request.url.split('?')[0] !== url.pathname)) {
        return reply(response, 400, { error: 'Only the fixed demo project is permitted' });
      }
      const body = await readBody(request);
      if (stopping) return reply(response, 503, { error: 'Gate stopping' });
      if (control) {
        if (url.pathname === `${CONTROL_PATH}status` && request.method === 'GET') {
          return reply(response, 200, { waiting: Boolean(held), forwarded, completed });
        }
        if (url.pathname === `${CONTROL_PATH}arm` && request.method === 'POST') {
          if (held || inFlight) return reply(response, 409, { error: 'A target request is pending' });
          let value;
          try { value = JSON.parse(body.toString('utf8')); } catch { return reply(response, 400, { error: 'Invalid JSON' }); }
          if (typeof value?.transactionId !== 'string' || !value.transactionId.trim() || value.transactionId.length > 1024) {
            return reply(response, 400, { error: 'A transactionId is required' });
          }
          targetTransactionId = value.transactionId;
          targetConsumed = false;
          forwarded = 0;
          completed = false;
          return reply(response, 200, { armed: true });
        }
        if (url.pathname === `${CONTROL_PATH}release` && request.method === 'POST') {
          if (!held) return reply(response, 409, { error: 'No target request is waiting' });
          const pending = held;
          held = undefined;
          clearTimeout(holdTimer);
          if (!forward(pending, true)) return reply(response, 409, { error: 'Target request disconnected' });
          return reply(response, 200, { released: true });
        }
        return reply(response, 404, { error: 'Unknown gate control' });
      }
      const pending = { response, body, method: request.method, headers: request.headers, path: url.pathname + url.search };
      let data;
      if (request.method === 'POST' && url.pathname === COMMAND_PATH) {
        try { data = JSON.parse(body.toString('utf8'))?.data; } catch { /* Real upstream owns domain validation. */ }
      }
      if (targetTransactionId && data?.command === 'ledger.update-transaction.v1' && data?.payload?.transactionId === targetTransactionId) {
        // Keep the target blocked even after a disconnect/deadline. A retry must not bypass the gate.
        if (targetConsumed) return reply(response, 503, { error: 'Target request is gated; explicitly arm again after failure' });
        targetConsumed = true;
        held = pending;
        holdTimer = setTimeout(() => {
          if (held !== pending) return;
          held = undefined;
          reply(response, 504, { error: 'Target request hold timed out' });
        }, holdTimeoutMs);
        holdTimer.unref();
        response.once('close', () => {
          if (held !== pending) return;
          held = undefined;
          clearTimeout(holdTimer);
        });
        return;
      }
      forward(pending);
    } catch (error) {
      reply(response, error.status ?? 400, { error: error.status === 413 ? 'Request body too large' : 'Invalid gate request' });
    }
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    port: server.address().port,
    stop() {
      if (stopPromise) return stopPromise;
      stopping = true;
      stopPromise = new Promise(resolve => {
        clearTimeout(holdTimer);
        if (held) reply(held.response, 503, { error: 'Gate stopping' });
        held = undefined;
        for (const upstream of upstreamRequests) upstream.destroy();
        server.close(resolve);
        // end() flushes the held request's 503 before closing its socket.
        for (const socket of sockets) socket.end();
        const timer = setTimeout(() => { for (const socket of sockets) socket.destroy(); }, 500);
        timer.unref();
        server.once('close', () => clearTimeout(timer));
      });
      return stopPromise;
    },
  };
}

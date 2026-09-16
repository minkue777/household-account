// 성능 테스트 전용: 제품의 Next production handler를 그대로 실행하고 외부 카탈로그만 제공합니다.
process.env.NODE_ENV = 'production';
const http = require('node:http');
const { createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const next = require('next');

const hostname = '127.0.0.1';
const port = 3100;
const fixturePrefix = '/__performance/catalog/';
const asOfDate = '2026-09-01';
const catalogVersion = 'performance-fixed-v1';
const objectName = `market-catalog/v1/snapshots/${asOfDate}/v1.json.gz`;
const items = Array.from({ length: 20 }, (_, index) => ({ market: 'KRX', instrumentType: 'STOCK',
  code: `PERF${String(index + 1).padStart(2, '0')}`, name: `성능 카탈로그 종목 ${index + 1}` }));
const snapshot = gzipSync(Buffer.from(JSON.stringify({ schemaVersion: 1, asOfDate, catalogVersion, itemCount: items.length, items })));
const manifest = { schemaVersion: 1, catalogVersion, snapshotObject: objectName, snapshotGeneration: '1001',
  asOfDate, publishedAt: `${asOfDate}T06:00:00+09:00`, sha256: createHash('sha256').update(snapshot).digest('hex'), itemCount: items.length };
const metadata = { name: objectName, bucket: 'e2e-catalog', generation: '1001', size: String(snapshot.length),
  contentType: 'application/gzip', type: 'file' };

async function start() {
  const app = next({ dev: false, hostname, port });
  await app.prepare();
  const handle = app.getRequestHandler();
  const server = http.createServer((request, response) => {
    const url = new URL(request.url || '/', `http://${hostname}:${port}`);
    if (!url.pathname.startsWith(fixturePrefix)) {
      void handle(request, response);
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const object = decodeURIComponent(url.pathname.slice(fixturePrefix.length));
    if (request.method !== 'GET' || !['market-catalog/v1/latest.json', objectName].includes(object)) {
      response.writeHead(404, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { code: 404, message: 'Unknown performance catalog fixture' } }));
      return;
    }
    const media = object === objectName && url.searchParams.get('alt') === 'media';
    const body = media ? snapshot : Buffer.from(JSON.stringify(object === objectName ? metadata : manifest));
    response.writeHead(200, { 'Content-Type': media ? 'application/octet-stream' : 'application/json', 'Content-Length': body.length });
    response.end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, resolve);
  });
  console.log(`Performance Next production server ready at http://${hostname}:${port}`);
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    server.close(() => { void app.close().finally(() => process.exit(0)); });
    server.closeAllConnections();
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

start().catch(error => { console.error(error); process.exitCode = 1; });

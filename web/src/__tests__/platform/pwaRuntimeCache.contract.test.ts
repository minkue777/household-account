let mockOptions: any;
jest.mock('next-pwa', () => (options: unknown) => { mockOptions = options; return (config: unknown) => config; });
require('../../../next.config.js');

describe('production Workbox에 전달되는 실제 PWA 구성', () => {
  it('development에서는 빈 header route를 만들지 않는다', async () => {
    // Read the actual Node config without Next/Jest replacing NODE_ENV at compile time.
    const moduleValue: { exports: any } = { exports: {} };
    require('node:vm').runInNewContext(require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../../../next.config.js'), 'utf8'), {
      require, module: moduleValue, process: { env: { ...process.env, NODE_ENV: 'development' } },
    });
    expect(await moduleValue.exports.headers()).toEqual([]);
  });
  it('수동 등록/대기 활성화와 hash asset만 precache한다', async () => {
    expect(mockOptions.register).toBe(false);
    expect(mockOptions.skipWaiting).toBe(false);
    expect(mockOptions.cacheStartUrl).toBe(false);
    const result = await mockOptions.manifestTransforms[0]([
      { url: '/_next/static/chunks/abc123.js' }, { url: '/api/expenses' }, { url: '/' }, { url: '/_next/static/a.js?uid=1' },
    ]);
    expect(result.manifest).toEqual([{ url: '/_next/static/chunks/abc123.js' }]);
  });
  it('인증·금융·임의 cross-origin·query 요청을 cache하지 않고 7일로 제한한다', () => {
    const rule = mockOptions.runtimeCaching[0];
    const match = (path: string, overrides = {}) => rule.urlPattern({
      url: new URL(path, 'https://example.com'), request: { method: 'GET', headers: new Headers() }, sameOrigin: true, ...overrides,
    });
    expect(match('/_next/static/chunks/a.js')).toBe(true);
    expect(match('/icons/icon-192x192.png')).toBe(true);
    for (const path of ['/', '/api/expenses', '/_next/static/a.js?householdId=1', '/assets/a.json']) expect(match(path)).toBe(false);
    expect(match('/_next/static/a.js', { sameOrigin: false })).toBe(false);
    expect(match('/_next/static/a.js', { request: { method: 'GET', headers: new Headers({ authorization: 'Bearer secret' }) } })).toBe(false);
    expect(rule.options.expiration.maxAgeSeconds).toBe(604800);
  });
  it.each(['private', 'no-store', 'max-age=60, private="x"'])('민감 response %s는 저장하지 않는다', async control => {
    const response = { status: 200, headers: new Headers({ 'cache-control': control }) };
    expect(await mockOptions.runtimeCaching[0].options.plugins[0].cacheWillUpdate({ response })).toBeNull();
  });
});

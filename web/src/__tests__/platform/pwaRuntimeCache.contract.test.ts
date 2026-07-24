import fs from 'node:fs';
import path from 'node:path';

describe('PWA runtime cache contract', () => {
  it('[PWA-004][AND-012] navigation 문서는 캐시하지 않고 버전 정적 자원만 캐시한다', () => {
    const nextConfig = fs.readFileSync(
      path.resolve(process.cwd(), 'next.config.js'),
      'utf8'
    );

    expect(nextConfig).toContain('cacheStartUrl: false');
    expect(nextConfig).not.toContain('StaleWhileRevalidate');
    expect(nextConfig).not.toContain('household-app-shell-pages');
    expect(nextConfig).toContain("urlPattern: /\\/_next\\/static\\/.*");
    expect(nextConfig).toContain("handler: 'CacheFirst'");
    expect(nextConfig).toContain("handler: 'NetworkOnly'");
  });
});

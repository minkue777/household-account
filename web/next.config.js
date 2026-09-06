const workerVersion = process.env.VERCEL_GIT_COMMIT_SHA || require('node:crypto').randomUUID();
const withPWA = require('next-pwa')({
  dest: 'public',
  // AppProviders registers this worker after the first useful ledger paint.
  // Android WebView must not install the web worker or start its precache.
  register: false,
  skipWaiting: false,
  clientsClaim: true,
  cacheId: 'household-static-v1',
  customWorkerDir: 'worker',
  disable: process.env.NODE_ENV === 'development',
  // Only immutable build assets are prepared atomically at install time.
  additionalManifestEntries: [],
  buildExcludes: [/\.map$/, /\.json$/],
  manifestTransforms: [async entries => ({
    manifest: entries.filter(entry => /^\/_next\/static\//.test(entry.url) && !entry.url.includes('?')),
    warnings: [],
  })],
  // The app is online-first. Caching a rendered page here can combine an old
  // client bundle with newly deployed Functions/Firestore contracts.
  cacheStartUrl: false,
  dynamicStartUrl: false,
  runtimeCaching: [
    {
      urlPattern: ({ url, request, sameOrigin }) => sameOrigin
        && request.method === 'GET' && !url.search
        && !request.headers.has('authorization') && !request.headers.has('cookie')
        && (/^\/_next\/static\//.test(url.pathname)
          || /^\/icons\/icon-[0-9]+x[0-9]+\.png$/.test(url.pathname)),
      handler: 'CacheFirst',
      options: {
        cacheName: 'immutable-next-static',
        expiration: { maxEntries: 64, maxAgeSeconds: 7 * 24 * 60 * 60 },
        plugins: [{ cacheWillUpdate: async ({ response }) => response.status === 200
          && !response.headers.has('set-cookie')
          && !/(?:^|,)\s*(?:private|no-store)(?:\s|,|=|$)/i.test(response.headers.get('cache-control') || '')
          ? response : null }],
      },
    },
    {
      urlPattern: /.*/,
      handler: 'NetworkOnly',
    },
  ],
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  generateBuildId: async () => workerVersion,
  env: {
    NEXT_PUBLIC_PWA_WORKER_VERSION: workerVersion,
    NEXT_PUBLIC_FIREBASE_EMULATOR_SUITE: process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_SUITE || 'false',
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || '',
    NEXT_PUBLIC_E2E_TEST_MODE: process.env.NEXT_PUBLIC_E2E_TEST_MODE || 'false',
  },
  async headers() {
    if (process.env.NODE_ENV === 'development') return [];
    return [
      {
        source: '/(.*)',
        headers: require('./scripts/productionSecurityPolicy.cjs').securityHeaders(),
      },
    ];
  },
};

module.exports = withPWA(nextConfig);

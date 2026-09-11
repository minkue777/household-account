const { createHash } = require('node:crypto');

function inlineScriptHashes(html) {
  return Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))
    .filter(([, attributes, body]) => !/\bsrc\s*=/i.test(attributes) && body.trim())
    .map(([, , body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
}

function securityHeaders(hashes = []) {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_SUITE === 'true'
    ? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID : 'household-account-6f300';
  if (!/^[a-z0-9-]+$/.test(projectId || '')) throw new Error('CSP_FIREBASE_PROJECT_INVALID');
  const emulatorOrigins = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_SUITE === 'true'
    ? ' http://127.0.0.1:9099 http://127.0.0.1:8080 http://127.0.0.1:5001 ws://127.0.0.1:9099' : '';
  const csp = [
    "default-src 'self'", `script-src 'self' https://apis.google.com ${Array.from(new Set(hashes)).join(' ')}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "font-src 'self'", "worker-src 'self'", "object-src 'none'", "base-uri 'self'",
    "form-action 'self' https://accounts.google.com", "frame-ancestors 'none'",
    `frame-src https://${projectId}.firebaseapp.com https://accounts.google.com`,
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://firebasestorage.googleapis.com https://firebaseinstallations.googleapis.com https://fcmregistrations.googleapis.com https://fcm.googleapis.com https://accounts.google.com"
      + ` https://asia-northeast3-${projectId}.cloudfunctions.net` + emulatorOrigins,
  ].join('; ');
  const headers = [
    { key: 'Content-Security-Policy', value: csp },
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ];
  validateSecurityHeaders(headers);
  return headers;
}

function validateSecurityHeaders(headers) {
  const values = new Map(headers.map(({ key, value }) => [key.toLowerCase(), value]));
  const directives = new Map((values.get('content-security-policy') || '').split(';').map(value => {
    const [name, ...sources] = value.trim().split(/\s+/); return [name, sources];
  }));
  for (const name of ['script-src', 'connect-src']) {
    const sources = directives.get(name);
    if (!sources?.length || sources.some(source => source.includes('*') || ['https:', 'http:', 'data:', "'unsafe-inline'", "'unsafe-eval'"].includes(source))) {
      throw new Error(`UNSAFE_CSP_${name}`);
    }
  }
  if (directives.get('frame-ancestors')?.join(' ') !== "'none'") throw new Error('UNSAFE_CSP_FRAMING');
  const maxAge = Number(/(?:^|;)\s*max-age=(\d+)/.exec(values.get('strict-transport-security') || '')?.[1]);
  if (!(maxAge >= 31536000)) throw new Error('INVALID_HSTS');
  if (values.get('x-content-type-options') !== 'nosniff'
    || !['no-referrer', 'strict-origin-when-cross-origin'].includes(values.get('referrer-policy'))
    || values.get('permissions-policy') !== 'camera=(), microphone=(), geolocation=()') throw new Error('INVALID_SECURITY_HEADERS');
}

function replaceSecurityHeaderRoutes(routes = [], headers) {
  const securityHeaderNames = new Set(headers.map(header => header.key.toLowerCase()));
  const preservedRoutes = routes.map(route => ({
    ...route,
    headers: route.headers.filter(header => !securityHeaderNames.has(header.key.toLowerCase())),
  })).filter(route => route.headers.length > 0);
  // Vercel rejects routes whose headers were emptied while replacing the policy.
  return [...preservedRoutes, {
    source: '/:path*',
    regex: '^(?:/((?:[^/]+?)(?:/(?:[^/]+?))*))?/?$',
    headers,
  }];
}

module.exports = { inlineScriptHashes, securityHeaders, validateSecurityHeaders, replaceSecurityHeaderRoutes };

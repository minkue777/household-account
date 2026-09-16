const http = require('node:http');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join, relative, resolve, isAbsolute, sep } = require('node:path');
const { randomBytes } = require('node:crypto');
const { createRequire } = require('node:module');
const root = resolve(__dirname, '../..');
const outputIndex = process.argv.indexOf('--token-file');
const tokenPath = outputIndex < 0 || !process.argv[outputIndex + 1] ? undefined : resolve(process.argv[outputIndex + 1]);
const r = createRequire(join(root, 'functions/package.json'));
const { initializeApp, applicationDefault } = r('firebase-admin/app');
const { getAuth } = r('firebase-admin/auth');
const projectId = 'household-account-6f300';
const nonce = randomBytes(32).toString('hex');

async function main() {
  if (!tokenPath) throw new Error('SMOKE_TOKEN_FILE_REQUIRED');
  const fromRoot = relative(root, tokenPath);
  if (fromRoot !== '..' && !fromRoot.startsWith('..' + sep) && !isAbsolute(fromRoot)) throw new Error('SMOKE_TOKEN_MUST_BE_OUTSIDE_REPOSITORY');
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST) throw new Error('PRODUCTION_EMULATOR_MIXED');
  const credential = applicationDefault();
  const { access_token } = await credential.getAccessToken();
  const identityResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${access_token}` }, signal: AbortSignal.timeout(15000),
  });
  if (!identityResponse.ok) throw new Error('OPERATOR_IDENTITY_REQUIRED');
  const identity = await identityResponse.json();
  if (!identity.email_verified || !identity.sub) throw new Error('OPERATOR_IDENTITY_REQUIRED');
  const auth = getAuth(initializeApp({ projectId, credential }));
  const operator = await auth.getUserByEmail(identity.email);
  if (operator.disabled || !operator.providerData.some(p => p.providerId === 'google.com' && p.uid === identity.sub)) {
    throw new Error('OPERATOR_IDENTITY_MISMATCH');
  }
  if (existsSync(tokenPath)) {
    try {
      const verified = await auth.verifyIdToken(readFileSync(tokenPath, 'utf8').trim(), true);
      if (verified.uid !== operator.uid || verified.firebase?.sign_in_provider !== 'google.com') throw new Error('OPERATOR_IDENTITY_MISMATCH');
      if (verified.exp > Date.now() / 1000 + 15 * 60) {
        console.log(JSON.stringify({smokeSession: 'ready', source: 'existing-token', expiresAt: verified.exp}));
        return;
      }
    } catch (error) {
      if (!['auth/id-token-expired', 'auth/id-token-revoked'].includes(error.code)) throw error;
    }
  }
  const configSource = readFileSync(join(root, 'web/src/platform/firebase/firebasePublicConfig.ts'), 'utf8');
  const apiKey = [...configSource.matchAll(/apiKey: '([^']+)'/g)].at(-1)?.[1];
  if (!apiKey || apiKey === 'demo-api-key') throw new Error('WEB_FIREBASE_CONFIG_REQUIRED');
  const sdkVersion = JSON.parse(readFileSync(join(root, 'web/package.json'), 'utf8')).dependencies.firebase.replace(/^[~^]/, '');
  if (!/^\d+\.\d+\.\d+$/.test(sdkVersion)) throw new Error('PINNED_FIREBASE_SDK_REQUIRED');
  const config = { apiKey, authDomain: `${projectId}.firebaseapp.com`, projectId };
  const page = `<!doctype html><html lang="ko"><meta charset="utf-8"><title>가계부 배포 확인</title>
    <style>body{font:18px system-ui;max-width:640px;margin:80px auto;padding:24px;line-height:1.7}button{font:inherit;padding:14px 24px;cursor:pointer}</style>
    <h1>가계부 배포 확인</h1><p>기존 가계부 Google 계정으로 로그인해 주세요. 배포 후 가구 접근을 확인하는 데만 사용하며 로그인을 이 브라우저에 유지하고 다음 배포에서는 자동으로 확인합니다.</p>
    <button id="login" disabled>Google로 로그인</button><button id="logout" hidden>이 브라우저에서 로그아웃</button><p id="status" role="status"></p>
    <script type="module">
      import { initializeApp } from 'https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-app.js';
      import { initializeAuth, browserLocalPersistence, browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/${sdkVersion}/firebase-auth.js';
      const auth = initializeAuth(initializeApp(${JSON.stringify(config)}), {persistence:browserLocalPersistence});
      const status = document.getElementById('status'), button = document.getElementById('login');
      let delivered = false;
      const logout = document.getElementById('logout');
      async function submitSession(user) {
        if (delivered) return;
        button.disabled = true; status.textContent = 'Google 로그인을 기다리고 있습니다.';
        try {
          const token = await user.getIdToken(true);
          const response = await fetch('/session', {method:'POST',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json','x-release-nonce':${JSON.stringify(nonce)}},body:JSON.stringify({token})});
          const body = await response.json();
          if (!response.ok) throw new Error(body.code);

          delivered = true;
          status.textContent = '확인 완료했습니다. 다음 배포에서는 이 브라우저의 로그인을 자동으로 재사용합니다. 창을 닫으셔도 됩니다.';
        } catch (error) {
          status.textContent = '로그인을 완료하지 못했습니다. ' + (error.code || error.message || 'UNKNOWN');
          button.disabled = false;
        }
      };
      onAuthStateChanged(auth, user => {
        logout.hidden = !user;
        if (user) void submitSession(user);
        else {
          button.disabled = false;
          status.textContent = '최초 한 번 기존 Google 계정으로 로그인해 주세요. 다음부터는 이 브라우저의 로그인을 재사용합니다.';
        }
      });
      logout.onclick = () => signOut(auth);
      button.onclick = async () => {
        delivered = false;
        status.textContent = 'Google 로그인 창을 기다리고 있습니다.';
        button.disabled = true;
        try {
          await signInWithPopup(auth, new GoogleAuthProvider(), browserPopupRedirectResolver);
        } catch (error) {
          status.textContent = '로그인을 완료하지 못했습니다. ' + (error.code || 'UNKNOWN');
          button.disabled = false;
        }
      };
    </script></html>`;
  const server = http.createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    const origin = `http://localhost:${server.address().port}`;
    if (request.headers.host !== `localhost:${server.address().port}`) { response.writeHead(403); response.end(); return; }
    if (request.method === 'GET' && request.url === '/') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(page); return;
    }
    if (request.method !== 'POST' || request.url !== '/session' || request.headers.origin !== origin || request.headers['x-release-nonce'] !== nonce) {
      response.writeHead(403); response.end(); return;
    }
    try {
      let raw = '';
      for await (const chunk of request) { raw += chunk; if (raw.length > 16384) throw new Error('REQUEST_TOO_LARGE'); }
      const { token } = JSON.parse(raw);
      const verified = await auth.verifyIdToken(token, true);
      if (verified.uid !== operator.uid || verified.firebase?.sign_in_provider !== 'google.com') throw new Error('OPERATOR_IDENTITY_MISMATCH');
      mkdirSync(dirname(tokenPath), { recursive: true, mode: 0o700 });
      writeFileSync(tokenPath, token, { mode: 0o600 });
      response.writeHead(200, {'content-type':'application/json'}); response.end(JSON.stringify({kind:'ready'}));
      console.log(JSON.stringify({smokeSession:'ready',expiresAt:verified.exp}));
      clearTimeout(timeout);
      setTimeout(() => { server.close(); server.closeAllConnections(); }, 1000);
    } catch {
      response.writeHead(400, {'content-type':'application/json'}); response.end(JSON.stringify({code:'기존 운영 계정으로 로그인했는지 확인해 주세요.'}));
    }
  });
  server.listen(55318, '127.0.0.1', () => console.log(JSON.stringify({loginUrl:'http://localhost:55318/'})));
  server.on('error', error => {
    console.error(JSON.stringify({code: error.code === 'EADDRINUSE' ? 'SMOKE_LOGIN_PORT_IN_USE' : 'SMOKE_LOGIN_SERVER_FAILED'}));
    clearTimeout(timeout);
    process.exitCode = 1;
  });
  const timeout = setTimeout(() => {
    console.error(JSON.stringify({code: 'SMOKE_LOGIN_TIMED_OUT'}));
    server.close(); server.closeAllConnections(); process.exitCode = 1;
  }, 40 * 60 * 1000);
  timeout.unref();
}
main().catch(error => {
  const candidate = String(error.code ?? error.message ?? 'SMOKE_LOGIN_HELPER_FAILED');
  const code = /^(auth\/[a-z-]+|[A-Z_0-9]+)$/.test(candidate) ? candidate : 'SMOKE_LOGIN_HELPER_FAILED';
  console.error(JSON.stringify({code})); process.exitCode = 1;
});


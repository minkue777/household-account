import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { copyFileSync, existsSync, mkdirSync, readFileSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';

export async function startNativeWebRuntime(root, output, adb) {
  const tlsDirectory = join(output, 'tls');
  const generated = join(root, 'android/app/build/generated/e2eTrust/res/raw');
  mkdirSync(tlsDirectory, { recursive: true });
  mkdirSync(generated, { recursive: true });
  const key = join(tlsDirectory, 'localhost.key');
  const cert = join(tlsDirectory, 'localhost.crt');
  const openssl = process.env.OPENSSL_PATH ?? (process.platform === 'win32' && existsSync('C:/Program Files/Git/usr/bin/openssl.exe') ? 'C:/Program Files/Git/usr/bin/openssl.exe' : 'openssl');
  execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-keyout', key, '-out', cert,
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1', '-addext', 'basicConstraints=critical,CA:TRUE'], { stdio: 'ignore' });
  copyFileSync(cert, join(generated, 'firebase_e2e_ca.pem'));
  // This process owns its server. Existing unrelated development servers are not reused.
  const occupied = await fetch('http://127.0.0.1:3100', { signal: AbortSignal.timeout(1000) }).then(() => true).catch(() => false);
  assert(!occupied, 'Port 3100 must be free before Native E2E');
  const environment = { ...process.env, DEBUG: '',
    NEXT_PUBLIC_FIREBASE_EMULATOR_SUITE: 'true', NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demo-household-account-e2e',
    NEXT_PUBLIC_E2E_TEST_MODE: 'true', NEXT_PUBLIC_E2E_TEST_EMAIL: 'playwright@household.test', NEXT_PUBLIC_E2E_TEST_PASSWORD: 'playwright-password-1234' };
  await new Promise((resolveBuild, reject) => {
    const build = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
      cwd: join(root, 'web'), env: environment, windowsHide: true, stdio: 'inherit', shell: process.platform === 'win32',
    });
    build.once('error', reject);
    build.once('exit', code => code === 0 ? resolveBuild() : reject(new Error(`Native E2E production Web build failed (${code})`)));
  });
  const log = openSync(join(output, 'next-server.log'), 'w');
  const next = spawn(process.execPath, [join(root, 'web/node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3100'], {
    cwd: join(root, 'web'), windowsHide: true, stdio: ['ignore', log, log], env: environment,
  });
  let startupError;
  next.on('error', error => { startupError = error; });
  const proxy = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (incoming, outgoing) => {
    const upstream = httpRequest({ hostname: '127.0.0.1', port: 3100, path: incoming.url, method: incoming.method, headers: incoming.headers }, response => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    upstream.on('error', () => { outgoing.writeHead(502); outgoing.end(); });
    incoming.pipe(upstream);
  });
  proxy.on('upgrade', (request, socket, head) => {
    const upstream = connect(3100, '127.0.0.1', () => {
      upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${Object.entries(request.headers).map(([name, value]) => `${name}: ${value}`).join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  const reversedPorts = [];
  async function stop() {
    proxy.closeAllConnections();
    proxy.close();
    for (const port of reversedPorts) { try { execFileSync(adb, ['reverse', '--remove', `tcp:${port}`], { stdio: 'ignore' }); } catch {} }
    if (next.exitCode === null) {
      if (process.platform === 'win32') spawn('taskkill', ['/PID', String(next.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      else next.kill('SIGTERM');
    }
    closeSync(log);
  }
  try {
    const deadline = Date.now() + 120_000;
    while (true) {
      if (startupError) throw startupError;
      assert(next.exitCode === null, 'Native E2E Next server exited before startup');
      const ready = await fetch('http://127.0.0.1:3100', { signal: AbortSignal.timeout(5000) }).then(response => response.ok).catch(() => false);
      if (ready) break;
      assert(Date.now() < deadline, 'Native E2E Next server startup deadline exceeded');
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await new Promise((resolve, reject) => { proxy.once('error', reject); proxy.listen(3443, '127.0.0.1', resolve); });
    for (const port of [3443, 9099, 8080, 5001]) {
      execFileSync(adb, ['reverse', `tcp:${port}`, `tcp:${port}`], { stdio: 'ignore' });
      reversedPorts.push(port);
    }
    return { origin: 'https://localhost:3443', stop };
  } catch (error) { await stop(); throw error; }
}

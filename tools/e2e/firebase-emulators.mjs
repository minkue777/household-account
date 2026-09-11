import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const transport = resolve(root, 'tools/e2e/firebase-fcm-transport.cjs').replaceAll('\\', '/');
const googleCloudTransport = resolve(root, 'tools/e2e/firebase-google-cloud-transport.cjs').replaceAll('\\', '/');
const command = process.argv[2];
if (!command) throw new Error('An E2E command or --start is required');
const child = spawn(process.execPath, [
  resolve(root, 'web/node_modules/firebase-tools/lib/bin/firebase.js'), '--config', resolve(root, 'firebase.e2e.json'),
  command === '--start' ? 'emulators:start' : 'emulators:exec', '--project', 'demo-household-account-e2e',
  '--only', 'auth,firestore,functions', '--log-verbosity', 'QUIET', ...(command === '--start' ? [] : [command]),
], {
  cwd: root, stdio: 'inherit', env: { ...process.env, DEBUG: '', HOUSEHOLD_E2E_FCM_TRANSPORT: 'true',
    HOUSEHOLD_E2E_CLOUD_LOGGING_TRANSPORT: 'true',
    SHORTCUT_INSTALL_URL: 'https://www.icloud.com/shortcuts/00000000000000000000000000000000',
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require="${transport}" --require="${googleCloudTransport}"`.trim() },
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => { if (signal) console.error(`Firebase E2E terminated: ${signal}`); process.exitCode = code ?? 1; });

const fs = require('node:fs');
const path = require('node:path');
const { inlineScriptHashes, securityHeaders, replaceSecurityHeaderRoutes } = require('./productionSecurityPolicy.cjs');

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}
const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, '.next/routes-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const htmlFiles = filesBelow(path.join(root, '.next/server')).filter(file => file.endsWith('.html'));
if (!htmlFiles.length) throw new Error('STATIC_HTML_MISSING');
const hashes = htmlFiles.flatMap(file => inlineScriptHashes(fs.readFileSync(file, 'utf8')));
const headers = securityHeaders(hashes);
if (headers[0].value.length > 14000) throw new Error('CSP_HEADER_TOO_LARGE');
// Next's production router and Vercel's Next adapter consume this manifest after
// the build command returns. Preserve static rendering and authorize exact bytes.
manifest.headers = replaceSecurityHeaderRoutes(manifest.headers, headers);
fs.writeFileSync(manifestPath, JSON.stringify(manifest));

const worker = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
const buildId = fs.readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8').trim();
const messagingWorker = fs.readFileSync(path.join(root, `public/worker-${buildId}.js`), 'utf8');
const firebaseVersion = require('firebase/package.json').version;
if (!/^12\.16\./.test(firebaseVersion)) throw new Error(`UNVERIFIED_WORKER_FIREBASE_SDK:${firebaseVersion}`);
if (!worker.includes(`worker-${buildId}.js`) || !worker.includes('/_next/static/')
  || !messagingWorker.includes(buildId) || !messagingWorker.includes('ACTIVATE_WAITING_WORKER')
  || !messagingWorker.includes('notification-payload.v1')
  || /process\.env\.NEXT_PUBLIC_/.test(messagingWorker)
  || /firebase-(?:app|messaging)-compat\.js|importScripts\([^)]*gstatic/.test(worker + messagingWorker)
  || fs.existsSync(path.join(root, 'public/firebase-messaging-sw.js'))) throw new Error('PWA_ARTIFACT_CONTRACT_INVALID');
const publicDirectory = path.resolve(root, 'public');
for (const entry of fs.readdirSync(publicDirectory, { withFileTypes: true })) {
  if (!entry.isFile() || !/^worker-[A-Za-z0-9-]+\.js(?:\.map|\.LICENSE\.txt)?$/.test(entry.name)
    || entry.name === `worker-${buildId}.js` || entry.name === `worker-${buildId}.js.map` || entry.name === `worker-${buildId}.js.LICENSE.txt`) continue;
  const generatedFile = path.resolve(publicDirectory, entry.name);
  if (path.dirname(generatedFile) !== publicDirectory) throw new Error('PWA_CLEANUP_PATH_INVALID');
  fs.unlinkSync(generatedFile);
}
console.log(`Production artifact verified: ${htmlFiles.length} static HTML files, ${new Set(hashes).size} CSP hashes, Firebase ${firebaseVersion}, one root worker.`);

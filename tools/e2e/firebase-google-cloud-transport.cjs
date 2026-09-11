// Cloud Logging and service-account OAuth have no Emulator. Replace only these
// external provider boundaries; the real reader, parser, aggregation and UI run.
const { createRequire } = require('node:module');
const { resolve, dirname, join } = require('node:path');
const requireFunctions = createRequire(resolve(__dirname, '../../functions/package.json'));
const { ApplicationDefaultCredential } = requireFunctions(
  join(dirname(requireFunctions.resolve('firebase-admin/app')), 'credential-internal.js'),
);
const { getFirestore } = requireFunctions('firebase-admin/firestore');
const { getApp } = requireFunctions('firebase-admin/app');
const projectId = 'demo-household-account-e2e';
const accessToken = 'e2e-cloud-logging-provider-token';
const loggingUrl = 'https://logging.googleapis.com/v2/entries:list';
const originalFetch = globalThis.fetch;

function assertLocalDemo() {
  let config;
  try { config = JSON.parse(process.env.FIREBASE_CONFIG || '{}'); }
  catch { throw new Error('E2E Cloud Logging transport requires a valid Firebase configuration'); }
  const projects = [process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT, config.projectId]
    .filter(value => value !== undefined && value !== '');
  if (process.env.HOUSEHOLD_E2E_CLOUD_LOGGING_TRANSPORT !== 'true'
      || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
      || projects.length === 0
      || projects.some(value => value !== projectId)) {
    throw new Error('E2E Cloud Logging transport may only run against the local demo Firebase Emulator');
  }
}

ApplicationDefaultCredential.prototype.getAccessToken = async function () {
  assertLocalDemo();
  // This is a provider credential, not a Firebase user ID/custom token. User
  // authentication and SDK verification remain on their real Emulator paths.
  return { access_token: accessToken, expires_in: 3600 };
};

globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url !== loggingUrl) return originalFetch.call(this, input, init);
  assertLocalDemo();
  if (init?.method !== 'POST') throw new Error('E2E Cloud Logging transport only supports entries:list POST');
  const headers = new Headers(init.headers);
  if (headers.get('authorization') !== `Bearer ${accessToken}`) {
    throw new Error('E2E Cloud Logging request must use the synthetic provider credential');
  }
  const body = JSON.parse(init.body);
  if (!Array.isArray(body.resourceNames) || body.resourceNames.length !== 1
      || body.resourceNames[0] !== `projects/${projectId}`) {
    throw new Error('E2E Cloud Logging transport rejects non-demo project resources');
  }
  if (getApp().options.projectId !== projectId) {
    throw new Error('E2E Cloud Logging fixture cannot use a non-demo Firestore app');
  }
  if (body.pageToken !== undefined) throw new Error('E2E Cloud Logging fixture does not define another page');
  const snapshot = await getFirestore().doc('e2eGoogleCloudTransport/interactiveLatency').get();
  const fixture = snapshot.data();
  // Persist only the non-secret query so the E2E verifies the actual provider
  // request contract without recording any token or credential.
  await getFirestore().doc('e2eGoogleCloudTransport/lastLoggingRequest').set(body);
  return new Response(JSON.stringify(fixture ?? { entries: [] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};

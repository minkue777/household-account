// FCM has no Emulator. Substitute only its outbound SDK transport; keep the production
// command, outbox trigger, recipient planner, delivery adapter and Firestore stores real.
const { createRequire } = require('node:module');
const { resolve, dirname, join } = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const requireFunctions = createRequire(resolve(__dirname, '../../functions/package.json'));
const { Messaging } = requireFunctions(join(dirname(requireFunctions.resolve('firebase-admin/messaging')), 'messaging.js'));
const { getFirestore } = requireFunctions('firebase-admin/firestore');

Messaging.prototype.send = async function (message, dryRun) {
  if (this.app.options.projectId !== 'demo-household-account-e2e'
      || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
      || process.env.HOUSEHOLD_E2E_FCM_TRANSPORT !== 'true') {
    throw new Error('E2E FCM transport may only run against the local demo Firebase Emulator');
  }
  if (dryRun) throw new Error('The E2E must exercise a real delivery attempt');
  const receiptId = randomUUID();
  await getFirestore(this.app).collection('e2eFcmTransport').doc(receiptId).set({ message, attemptedAt: new Date().toISOString() });
  if (String(message.fid).endsWith('-delayed-unregistered')) {
    // Hold only the provider response, so a real endpoint registration can race it.
    const control = getFirestore(this.app).collection('e2eFcmTransportControls')
      .doc(createHash('sha256').update(message.fid).digest('hex'));
    const deadline = Date.now() + 30_000;
    while ((await control.get()).data()?.released !== true) {
      if (Date.now() >= deadline) throw new Error('E2E_PROVIDER_RESPONSE_NOT_RELEASED');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  if (String(message.fid).endsWith('-unregistered')) {
    const error = new Error('Synthetic provider rejection');
    error.code = 'messaging/registration-token-not-registered';
    error.httpStatus = 404;
    error.details = { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } };
    throw error;
  }
  const failure = ['timeout', 'quota', 'credential', 'network'].find(kind => String(message.fid).endsWith(`-${kind}`));
  if (failure) {
    const error = new Error(`Synthetic provider ${failure}`);
    error.code = { timeout: 'messaging/timeout', quota: 'messaging/quota-exceeded', credential: 'messaging/invalid-credential', network: 'messaging/network-error' }[failure];
    throw error;
  }
  return `projects/demo-household-account-e2e/messages/${receiptId}`;
};

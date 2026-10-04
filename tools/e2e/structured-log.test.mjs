import assert from 'node:assert/strict';
import test from 'node:test';
import { firstLogObject } from './structured-log.mjs';

test('Firebase runtime payload and appended CLI metadata stay separate', () => {
  const payload = { endpoint: 'clientStartup', diagnostics: { android: { webDurationMs: 200 } } };
  const message = JSON.stringify(payload);
  const metadata = { user: payload, metadata: { message: `>  ${message}` } };
  assert.deepEqual(firstLogObject(`[info] >  ${message} ${JSON.stringify(metadata)}`), payload);
  assert.deepEqual(firstLogObject(`>  ${message}`), payload);
});

test('Quoted braces and escaped quotes do not end the payload', () => {
  const payload = { text: 'a } " \\ {', nested: { values: [{ x: 1 }] } };
  assert.deepEqual(firstLogObject(`${JSON.stringify(payload)} {"ignored":true}`), payload);
});

test('Missing, truncated and invalid payloads fail instead of inventing successful evidence', () => {
  for (const input of ['no payload', '{"x":1', '{invalid}']) assert.throws(() => firstLogObject(input));
});

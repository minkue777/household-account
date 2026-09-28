import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { startNativeCommandGate } from './native-command-gate.mjs';

const prefix = '/demo-household-account-e2e/asia-northeast3/';

async function fixture(t, { gateOptions = {}, hangUpstream = false } = {}) {
  const received = [];
  const upstream = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    received.push({ path: request.url, body, authorization: request.headers.authorization });
    if (hangUpstream) return;
    response.writeHead(202, { 'content-type': 'application/json', 'x-real-upstream': 'yes' });
    response.end(body);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const gate = await startNativeCommandGate({ ...gateOptions, port: 0, upstreamPort: upstream.address().port });
  t.after(async () => {
    await gate.stop();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  });
  const base = `http://127.0.0.1:${gate.port}`;
  const post = (path, value, signal = AbortSignal.timeout(5000)) => fetch(base + path, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    body: typeof value === 'string' ? value : JSON.stringify(value), signal,
  });
  const status = async () => (await fetch(base + '/__quickedit_gate/status')).json();
  return { gate, received, base, post, status };
}

test('forwards actual callable request and response bytes and rejects a different project', async t => {
  const f = await fixture(t);
  const body = '{ "data": {"query":"actual-query"} }';
  const response = await f.post(prefix + 'queryHousehold', body);
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('x-real-upstream'), 'yes');
  assert.equal(await response.text(), body);
  assert.deepEqual(f.received, [{ path: prefix + 'queryHousehold', body, authorization: 'Bearer test-token' }]);
  assert.equal((await f.post('/production/asia-northeast3/executeHouseholdCommand', {})).status, 400);
  assert.equal(f.received.length, 1);
});

test('holds one matching update while other requests pass, then releases the actual upstream response', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/__quickedit_gate/arm', { transactionId: 'target' })).status, 200);
  const body = { data: { command: 'ledger.update-transaction.v1', payload: { transactionId: 'target', patch: { memo: 'real-data' } } } };
  const pending = f.post(prefix + 'executeHouseholdCommand', body);
  for (let i = 0; i < 100 && !(await f.status()).waiting; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(await f.status(), { waiting: true, forwarded: 0, completed: false });
  assert.equal(f.received.length, 0);
  assert.equal((await f.post(prefix + 'executeHouseholdCommand', body)).status, 503);
  assert.equal(f.received.length, 0);
  assert.equal((await f.post('/__quickedit_gate/arm', { transactionId: 'other' })).status, 409);
  assert.equal((await f.post(prefix + 'queryHousehold', { data: {} })).status, 202);
  assert.equal((await f.post(prefix + 'executeHouseholdCommand', { data: { command: 'ledger.update-transaction.v1', payload: { transactionId: 'other' } } })).status, 202);
  assert.deepEqual(await f.status(), { waiting: true, forwarded: 0, completed: false });
  assert.equal((await f.post('/__quickedit_gate/release', {})).status, 200);
  const actual = await pending;
  assert.equal(actual.status, 202);
  assert.deepEqual(await actual.json(), body);
  assert.deepEqual(await f.status(), { waiting: false, forwarded: 1, completed: true });
  assert.equal(f.received.length, 3);
  assert.equal((await f.post('/__quickedit_gate/arm', { transactionId: 'next' })).status, 200);
  assert.deepEqual(await f.status(), { waiting: false, forwarded: 0, completed: false });
});

test('an aborted held request cannot let a retry reach the real upstream', async t => {
  const f = await fixture(t);
  await f.post('/__quickedit_gate/arm', { transactionId: 'target' });
  const body = { data: { command: 'ledger.update-transaction.v1', payload: { transactionId: 'target' } } };
  const controller = new AbortController();
  const pending = f.post(prefix + 'executeHouseholdCommand', body, controller.signal).catch(error => error);
  for (let i = 0; i < 100 && !(await f.status()).waiting; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.status()).waiting, true);
  controller.abort();
  assert.equal((await pending).name, 'AbortError');
  for (let i = 0; i < 100 && (await f.status()).waiting; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(await f.status(), { waiting: false, forwarded: 0, completed: false });
  assert.equal((await f.post(prefix + 'executeHouseholdCommand', body)).status, 503);
  assert.equal((await f.post('/__quickedit_gate/release', {})).status, 409);
  assert.equal(f.received.length, 0);
});

test('the hold deadline fails closed until the target is explicitly armed again', async t => {
  const f = await fixture(t, { gateOptions: { holdTimeoutMs: 50 } });
  await f.post('/__quickedit_gate/arm', { transactionId: 'target' });
  const body = { data: { command: 'ledger.update-transaction.v1', payload: { transactionId: 'target' } } };
  assert.equal((await f.post(prefix + 'executeHouseholdCommand', body)).status, 504);
  assert.deepEqual(await f.status(), { waiting: false, forwarded: 0, completed: false });
  assert.equal((await f.post(prefix + 'executeHouseholdCommand', body)).status, 503);
  assert.equal((await f.post('/__quickedit_gate/release', {})).status, 409);
  assert.equal(f.received.length, 0);
  assert.equal((await f.post('/__quickedit_gate/arm', { transactionId: 'target' })).status, 200);
  const pending = f.post(prefix + 'executeHouseholdCommand', body);
  for (let i = 0; i < 100 && !(await f.status()).waiting; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.status()).waiting, true);
  assert.equal((await f.post('/__quickedit_gate/release', {})).status, 200);
  assert.equal((await pending).status, 202);
  assert.equal(f.received.length, 1);
});

test('the real upstream deadline does not synthesize success or permit a retry', async t => {
  const f = await fixture(t, { gateOptions: { upstreamTimeoutMs: 50 }, hangUpstream: true });
  await f.post('/__quickedit_gate/arm', { transactionId: 'target' });
  const body = { data: { command: 'ledger.update-transaction.v1', payload: { transactionId: 'target' } } };
  const pending = f.post(prefix + 'executeHouseholdCommand', body);
  for (let i = 0; i < 100 && !(await f.status()).waiting; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.post('/__quickedit_gate/release', {})).status, 200);
  assert.equal((await f.post(prefix + 'executeHouseholdCommand', body)).status, 503);
  assert.equal((await pending).status, 504);
  assert.deepEqual(await f.status(), { waiting: false, forwarded: 1, completed: false });
  assert.equal((await f.post(prefix + 'executeHouseholdCommand', body)).status, 503);
  assert.equal(f.received.length, 1);
  assert.equal(f.gate.stop(), f.gate.stop());
});

test('caps bodies at 1 MiB and stop flushes a 503 to a held request', async t => {
  const f = await fixture(t);
  assert.equal((await f.post('/__quickedit_gate/arm', 'x'.repeat(1024 * 1024 + 1))).status, 413);
  assert.equal((await f.post(prefix + 'queryHousehold', 'x'.repeat(1024 * 1024 + 1))).status, 413);
  await f.post('/__quickedit_gate/arm', { transactionId: 'target' });
  const pending = f.post(prefix + 'executeHouseholdCommand', { data: { command: 'ledger.update-transaction.v1', payload: { transactionId: 'target' } } });
  for (let i = 0; i < 100 && !(await f.status()).waiting; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await f.status()).waiting, true);
  await f.gate.stop();
  assert.equal((await pending).status, 503);
  assert.equal(f.received.length, 0);
});

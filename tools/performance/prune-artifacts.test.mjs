import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { prunePerformanceArtifacts, runCli, selectArtifactsToPrune } from './prune-artifacts.mjs';

const repository = 'minkue777/household-account';
const commit = 'a'.repeat(40);
const report = (platform = 'web', runId = '200') => ({ runId, platform, commit, path: `${platform}.html`, artifactId: `${runId}${platform === 'web' ? '1' : '2'}` });
const artifact = (platform = 'web', runId = '200', extra = {}) => ({ id: report(platform, runId).artifactId,
  name: `quality-${platform}-performance`, expired: false, size_in_bytes: 12,
  workflow_run: { id: runId, head_branch: 'main', head_sha: commit }, ...extra });
const run = (id, extra = {}) => ({ id, status: 'completed', event: 'push', head_branch: 'main',
  path: '.github/workflows/quality-gates.yml', head_repository: { full_name: repository }, ...extra });

function harness(options = {}) {
  const deleted = [];
  const accessed = [];
  return { repository, manifest: [report()], deleted, accessed,
    listArtifacts: async () => [artifact()],
    getRun: async ({ runId }) => { accessed.push(runId); return run(runId); },
    deleteArtifact: async ({ artifactId }) => { deleted.push(artifactId); }, ...options };
}

test('deletes only older completed main performance sources independently per published platform', async () => {
  const options = harness({ manifest: [report('web', '300'), report('android', '200')],
    listArtifacts: async () => [artifact('web', '300'), artifact('android', '200'),
      artifact('web', '299'), artifact('android', '299'), artifact('web', '100'), artifact('android', '100'),
      artifact('web', '301'), artifact('android', '201'), artifact('web', '50', { expired: true }),
      artifact('web', '40', { name: 'quality-web' }), artifact('web', '30', { name: 'quality-web-performance-extra' }),
      artifact('web', '20', { workflow_run: { id: '20', head_branch: 'feature' } }),
      artifact('web', '10', { workflow_run: undefined })],
  });
  const deleted = await prunePerformanceArtifacts(options);
  assert.deepEqual(options.deleted, ['2991', '1001', '1002']);
  assert.deepEqual(options.accessed, ['299', '100']);
  assert.deepEqual(deleted, options.deleted.map(id => ({ id, name: `quality-${id.endsWith('1') ? 'web' : 'android'}-performance`, bytes: 12 })));
});

test('preserves same-run replacements and platforms absent from the published manifest', async () => {
  const options = harness({ listArtifacts: async () => [artifact(), artifact('web', '200', { id: '9991' }),
    artifact('android', '1'), artifact('web', '199')] });
  await prunePerformanceArtifacts(options);
  assert.deepEqual(options.deleted, ['1991']);
  assert.deepEqual(options.accessed, ['199']);
});

test('exports selection separately so a dry run never calls deletion', async () => {
  const options = harness({ listArtifacts: async () => [artifact(), artifact('web', '100')],
    deleteArtifact: async () => assert.fail('selection must be read-only'),
  });
  assert.deepEqual(await selectArtifactsToPrune(options), [{ id: '1001', name: 'quality-web-performance', bytes: 12 }]);
});

test('skips in-progress, PR, foreign-repository, non-main and unrelated workflow runs', async () => {
  const changes = [{ status: 'in_progress' }, { event: 'pull_request' },
    { head_repository: { full_name: 'outsider/household-account' } }, { head_branch: 'feature' },
    { path: '.github/workflows/other.yml' }, { id: '999' }, { event: 'workflow_run' }, { head_repository: { full_name: 123 } }];
  const options = harness({ listArtifacts: async () => [artifact(), ...changes.map((_, index) => artifact('web', String(index + 1)))],
    getRun: async ({ runId }) => run(runId, changes[Number(runId) - 1]),
  });
  assert.deepEqual(await prunePerformanceArtifacts(options), []);
  assert.deepEqual(options.deleted, []);
});

test('accepts completed manual main CI and compares large run IDs without number rounding', async () => {
  const current = '9223372036854775810';
  const previous = '9223372036854775809';
  const options = harness({ manifest: [{ ...report('web', current), artifactId: '999' }],
    listArtifacts: async () => [artifact('web', current, { id: '999' }), artifact('web', previous, { id: '998' })],
    getRun: async ({ runId }) => run(runId, { event: 'workflow_dispatch' }),
  });
  assert.deepEqual(await prunePerformanceArtifacts(options), [{ id: '998', name: 'quality-web-performance', bytes: 12 }]);
});

test('rejects every malformed or duplicate manifest before reading or deleting GitHub artifacts', async () => {
  const malformed = [null, [], {}, [null], [report(), report()], [report(), report('android'), report('android', '201')],
    [{ ...report(), platform: '__proto__' }], [{ ...report(), platform: 'ios' }], [{ ...report(), platform: ['web'] }],
    [{ ...report(), path: '../web.html' }], [{ ...report(), commit: '' }], [{ ...report(), commit: 123 }],
    [{ ...report(), runId: '../200' }], [{ ...report(), runId: 1.5 }], [{ ...report(), runId: 0 }],
    [{ ...report(), runId: Number.MAX_SAFE_INTEGER + 1 }], [{ ...report(), artifactId: '' }],
    [{ ...report(), artifactId: '--method=DELETE' }], [report(), { ...report('android'), artifactId: report().artifactId }]];
  for (const manifest of malformed) {
    await assert.rejects(prunePerformanceArtifacts(harness({ manifest,
      listArtifacts: async () => assert.fail('invalid manifest must not read artifacts'),
      deleteArtifact: async () => assert.fail('invalid manifest must not delete artifacts'),
    })));
  }
  for (const value of ['../repo', 'owner/..', 'owner/repo/extra', '']) {
    await assert.rejects(prunePerformanceArtifacts(harness({ repository: value,
      listArtifacts: async () => assert.fail('invalid repository must not access GitHub'),
    })));
  }
});

test('rejects stale or forged published sources before deletion', async () => {
  const variations = [[], [artifact(), artifact()], [artifact('android')], [artifact('web', '200', { expired: true })],
    [artifact('web', '200', { workflow_run: { id: '999', head_branch: 'main', head_sha: commit } })],
    [artifact('web', '200', { workflow_run: { id: '200', head_branch: 'main', head_sha: 'b'.repeat(40) } })],
    [artifact('web', '200', { workflow_run: { id: '200', head_branch: 'feature', head_sha: commit } })]];
  for (const sources of variations) {
    const options = harness({ listArtifacts: async () => [...sources, artifact('web', '100')] });
    await assert.rejects(prunePerformanceArtifacts(options), /provenance mismatch/);
    assert.deepEqual(options.deleted, []);
  }
});

test('validates all candidate metadata and run lookups before the first deletion', async () => {
  for (const extra of [{ id: '../1' }, { size_in_bytes: -1 }, { size_in_bytes: 1.5 }, { id: '1001' }]) {
    const options = harness({ listArtifacts: async () => [artifact(), artifact('web', '100'), artifact('web', '99', extra)] });
    await assert.rejects(prunePerformanceArtifacts(options));
    assert.deepEqual(options.deleted, []);
  }
  const options = harness({ listArtifacts: async () => [artifact(), artifact('web', '100'), artifact('web', '99')],
    getRun: async ({ runId }) => { if (runId === '99') throw new Error('API failed'); return run(runId); },
  });
  await assert.rejects(prunePerformanceArtifacts(options), /API failed/);
  assert.deepEqual(options.deleted, []);
});

test('CLI paginates repository artifacts, checks each run and deletes only exact artifact IDs', async t => {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, 'household-performance-prune-test-'));
  t.after(() => {
    const suffix = relative(parent, root);
    assert(suffix.startsWith('household-performance-prune-test-') && !suffix.includes(sep));
    rmSync(root, { recursive: true, force: true });
  });
  const path = join(root, 'manifest.json');
  writeFileSync(path, JSON.stringify([report()]));
  const calls = [];
  const summaries = [];
  const options = { argv: [path], env: { GITHUB_REPOSITORY: repository, GH_TOKEN: 'test-token' },
    summary: value => summaries.push(value), gh: async args => {
      calls.push(args);
      if (args.includes('--paginate')) return JSON.stringify([{ artifacts: [artifact()] }, { artifacts: [artifact('web', '100')] }]);
      if (args.includes('DELETE')) return '';
      return JSON.stringify(run('100'));
    },
  };
  assert.deepEqual(await runCli(options), [{ id: '1001', name: 'quality-web-performance', bytes: 12 }]);
  assert.deepEqual(calls, [
    ['api', '--hostname', 'github.com', '--paginate', '--slurp', `repos/${repository}/actions/artifacts?per_page=100`],
    ['api', '--hostname', 'github.com', `repos/${repository}/actions/runs/100`],
    ['api', '--hostname', 'github.com', '--method', 'DELETE', `repos/${repository}/actions/artifacts/1001`],
  ]);
  assert.deepEqual(JSON.parse(summaries[0]), [{ id: '1001', name: 'quality-web-performance', bytes: 12 }]);
  await assert.rejects(runCli({ argv: [], env: {} }), /Usage/);
  await assert.rejects(runCli({ argv: [path], env: {} }), /GH_TOKEN/);
  await assert.rejects(runCli({ ...options, gh: async () => JSON.stringify([{ artifacts: null }]) }), /artifact response/);
});

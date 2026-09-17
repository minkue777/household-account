import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { buildPerformanceSite, runCli } from './publish-site.mjs';
import { renderPerformanceReport } from './html-report.mjs';

const repository = 'minkue777/household-account';
const sha = 'a'.repeat(40);
const run = (id = '100', head_sha = sha, extra = {}) => ({ id, head_sha, status: 'completed', event: 'push',
  head_branch: 'main', head_repository: { full_name: repository }, ...extra });
const artifact = (source, platform, extra = {}) => ({ id: `${source.id}${platform === 'web' ? '1' : '2'}`,
  name: `quality-${platform}-performance`, expired: false,
  workflow_run: { id: source.id, head_sha: source.head_sha, head_branch: source.head_branch }, ...extra });

function fixtureReport(commit = sha, failed = false) {
  return { commit, status: failed ? 'failed' : 'reported', timestamp: '2026-09-17T09:00:00Z',
    coverage: { complete: !failed },
    performance: { mode: 'report-only', status: failed ? 'invalid' : 'reported', samplesRequested: 7,
      coverage: { complete: !failed }, errors: failed ? ['측정 실패 · 표본 누락'] : [], results: [] } };
}

function writeArtifact(directory, platform, { report = fixtureReport(), nested = false, html = renderPerformanceReport(report), missingHtml = false } = {}) {
  const base = join(directory, nested ? 'performance-results' : '', platform);
  mkdirSync(dirname(base), { recursive: true });
  writeFileSync(`${base}.json`, JSON.stringify(report));
  if (!missingHtml) writeFileSync(`${base}.html`, html);
  return Buffer.from(html);
}

function harness(t, options = {}) {
  const parent = resolve(tmpdir());
  const root = mkdtempSync(join(parent, 'household-performance-publish-test-'));
  t.after(() => {
    const suffix = relative(parent, root);
    assert(suffix.startsWith('household-performance-publish-test-') && !suffix.includes(sep));
    rmSync(root, { recursive: true, force: true });
  });
  return { root, outputDir: join(root, 'site'), temporaryRoot: root, repository, runs: [run()],
    listArtifacts: async () => [artifact(run(), 'web')],
    downloadArtifact: async ({ destination }) => { writeArtifact(destination, 'web'); }, ...options };
}

function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? files(join(root, entry.name)).map(name => `${entry.name}/${name}`) : [entry.name]).sort();
}

test('publishes only allowlisted HTML, numeric run history and independent latest platform reports without changing bytes', async t => {
  const sources = [run('9', '9'.repeat(40)), run('100'), run('200', 'b'.repeat(40))];
  const original = new Map();
  const selected = [];
  const options = harness(t, { runs: sources,
    listArtifacts: async ({ runId }) => {
      selected.push(runId);
      const source = sources.find(item => item.id === runId);
      return (runId === '100' ? ['web'] : runId === '200' ? ['android'] : ['web', 'android'])
        .map(platform => artifact(source, platform));
    },
    downloadArtifact: async ({ destination, runId, artifactName }) => {
      const platform = artifactName === 'quality-web-performance' ? 'web' : 'android';
      const report = fixtureReport(sources.find(item => item.id === runId).head_sha);
      const html = renderPerformanceReport(report).replaceAll('\n', '\r\n');
      original.set(`${runId}/${platform}`, writeArtifact(destination, platform, { report, html, nested: runId === '200' }));
      mkdirSync(join(destination, 'failures'), { recursive: true });
      writeFileSync(join(destination, 'failures', 'private.log'), 'must not be published');
      writeFileSync(join(destination, 'screenshot.png'), 'must not be published');
      writeFileSync(join(destination, 'diagnostics.html'), 'must not be published');
    },
  });
  const published = await buildPerformanceSite(options);
  assert.deepEqual(selected, ['200', '100', '9']);
  assert.deepEqual(files(options.outputDir), ['.nojekyll', 'android.html', 'index.html', 'runs/100/web.html',
    'runs/200/android.html', 'runs/9/android.html', 'runs/9/web.html', 'web.html']);
  for (const item of published) {
    assert.equal(item.path, `runs/${item.runId}/${item.platform}.html`);
    assert.deepEqual(readFileSync(join(options.outputDir, item.path)), original.get(`${item.runId}/${item.platform}`));
  }
  assert.deepEqual(readFileSync(join(options.outputDir, 'web.html')), original.get('100/web'));
  assert.deepEqual(readFileSync(join(options.outputDir, 'android.html')), original.get('200/android'));
  assert.deepEqual(readFileSync(join(options.outputDir, 'index.html')), original.get('100/web'));
  assert.deepEqual(readdirSync(options.root), ['site']);
});

test('ignores PR, other repository, non-main and incomplete runs before accessing artifacts', async t => {
  const accessed = [];
  const options = harness(t, { runs: [run(), run('101', sha, { event: 'pull_request' }),
    run('102', sha, { head_repository: { full_name: 'outsider/household-account' } }),
    run('103', sha, { head_branch: 'feature' }), run('104', sha, { status: 'in_progress' }),
    run('105', sha, { event: 'workflow_run' }), run('99', sha, { event: 'workflow_dispatch' })],
    listArtifacts: async ({ runId }) => { accessed.push(runId); return [artifact(run(runId), 'web')]; },
  });
  await buildPerformanceSite(options);
  assert.deepEqual(accessed, ['100', '99']);
});

test('retains at most the latest twenty completed main runs', async t => {
  const options = harness(t, { runs: Array.from({ length: 23 }, (_, index) => run(String(index + 1))),
    listArtifacts: async ({ runId }) => [artifact(run(runId), 'web')],
  });
  const published = await buildPerformanceSite(options);
  assert.equal(published.length, 20);
  assert.equal(published[0].runId, '23');
  assert.equal(published.at(-1).runId, '4');
  assert(!existsSync(join(options.outputDir, 'runs/3')));
});

test('skips expired or missing HTML and keeps an Android-only measurement failure report unchanged', async t => {
  const sources = [run('103'), run('102'), run('101'), run('100')];
  const downloaded = [];
  const report = fixtureReport(sha, true);
  delete report.commit; // Historical Android schema used artifact/run provenance.
  const html = renderPerformanceReport(report);
  const options = harness(t, { runs: sources,
    listArtifacts: async ({ runId }) => runId === '101' ? [] : [artifact(run(runId), runId === '100' ? 'android' : 'web', { expired: runId === '103' })],
    downloadArtifact: async ({ destination, runId }) => {
      downloaded.push(runId);
      writeArtifact(destination, runId === '100' ? 'android' : 'web', { report, html, missingHtml: runId === '102' });
    },
  });
  const published = await buildPerformanceSite(options);
  assert.deepEqual(downloaded, ['102', '100']);
  assert.deepEqual(published, [{ runId: '100', platform: 'android', commit: sha, path: 'runs/100/android.html' }]);
  assert(!existsSync(join(options.outputDir, 'web.html')));
  assert.equal(readFileSync(join(options.outputDir, 'index.html'), 'utf8'), html);
  assert.match(html, /측정 실패 · 표본 누락/);
});

test('Android provenance also works with older run-scoped artifact responses lacking workflow_run', async t => {
  const report = fixtureReport();
  delete report.commit;
  const options = harness(t, { listArtifacts: async () => [artifact(run(), 'android', { workflow_run: undefined })],
    downloadArtifact: async ({ destination }) => { writeArtifact(destination, 'android', { report }); },
  });
  assert.equal((await buildPerformanceSite(options))[0].commit, sha);
});

test('preserves a valid historic HTML layout without coupling publication to current chart markup or CSP formatting', async t => {
  const html = '<!doctype html>\n<html lang="ko"><head><meta content="default-src \'none\'" http-equiv="Content-Security-Policy"></head>\n<body><article>이전 그래프 · 180 ms</article></body></html>\n';
  const options = harness(t, { downloadArtifact: async ({ destination }) => { writeArtifact(destination, 'web', { html }); } });
  await buildPerformanceSite(options);
  assert.equal(readFileSync(join(options.outputDir, 'web.html'), 'utf8'), html);
});

test('rejects explicit commit mismatches, missing Web commit, malformed JSON and HTML before writing any site', async t => {
  for (const kind of ['web-commit', 'android-commit', 'web-missing-commit', 'invalid-json', 'html-commit', 'html-truncated', 'json-missing']) {
    await t.test(kind, async t => {
      const platform = kind.startsWith('android') ? 'android' : 'web';
      const options = harness(t, { listArtifacts: async () => [artifact(run(), platform)],
        downloadArtifact: async ({ destination }) => {
          const report = fixtureReport();
          if (kind.endsWith('-commit') && kind !== 'html-commit' && kind !== 'web-missing-commit') report.commit = 'b'.repeat(40);
          if (kind === 'web-missing-commit') delete report.commit;
          const html = kind === 'html-commit' ? renderPerformanceReport(fixtureReport('b'.repeat(40)))
            : kind === 'html-truncated' ? '<!doctype html><html><body>error' : renderPerformanceReport(report);
          writeArtifact(destination, platform, { report, html });
          if (kind === 'invalid-json') writeFileSync(join(destination, `${platform}.json`), '{');
          if (kind === 'json-missing') rmSync(join(destination, `${platform}.json`));
        },
      });
      await assert.rejects(buildPerformanceSite(options));
      assert(!existsSync(options.outputDir));
      assert.deepEqual(readdirSync(options.root), []);
    });
  }
});

test('rejects artifact run, branch and commit provenance mismatches without downloading', async t => {
  for (const origin of [{ id: '99', head_sha: sha, head_branch: 'main' },
    { id: '100', head_sha: 'b'.repeat(40), head_branch: 'main' },
    { id: '100', head_sha: sha, head_branch: 'feature' }]) {
    const options = harness(t, { listArtifacts: async () => [artifact(run(), 'android', { workflow_run: origin })],
      downloadArtifact: async () => assert.fail('untrusted artifact must not be downloaded') });
    await assert.rejects(buildPerformanceSite(options), /provenance mismatch/);
  }
});

test('rejects malformed repository, run ID, SHA and unsafe output paths before downloading', async t => {
  const options = harness(t, { listArtifacts: async () => assert.fail('invalid input must not access artifacts') });
  for (const invalid of [
    { repository: '../outside' }, { repository: 'owner/repo/extra' }, { repository: 'owner/..' },
    { runs: [run('../100')] }, { runs: [run(1.5)] }, { runs: [run('0')] }, { runs: [run('100', 'short')] },
    { outputDir: process.cwd() }, { outputDir: dirname(process.cwd()) }, { outputDir: '' },
  ]) await assert.rejects(buildPerformanceSite({ ...options, ...invalid }));
});

test('empty or invalid source does not replace a previous output or write a partial site', async t => {
  const options = harness(t, { listArtifacts: async () => [] });
  await assert.rejects(buildPerformanceSite(options), /No publishable/);
  assert(!existsSync(options.outputDir));
  mkdirSync(options.outputDir);
  writeFileSync(join(options.outputDir, 'index.html'), 'previous site');
  await assert.rejects(buildPerformanceSite(options), /must be empty/);
  assert.equal(readFileSync(join(options.outputDir, 'index.html'), 'utf8'), 'previous site');
});

test('rejects ambiguous report locations and symbolic-link report directories', async t => {
  for (const kind of ['ambiguous', 'symlink']) {
    await t.test(kind, async t => {
      const options = harness(t, { listArtifacts: async () => [artifact(run(), 'android')],
        downloadArtifact: async ({ destination }) => {
          writeArtifact(destination, 'android');
          if (kind === 'ambiguous') writeArtifact(destination, 'android', { nested: true });
          else {
            const outside = join(options.root, 'outside');
            mkdirSync(outside);
            writeArtifact(outside, 'android');
            symlinkSync(outside, join(destination, 'performance-results'), 'junction');
          }
        },
      });
      await assert.rejects(buildPerformanceSite(options), kind === 'ambiguous' ? /Ambiguous HTML/ : /symbolic links/);
      assert(!existsSync(options.outputDir));
    });
  }
});

test('CLI uses the main workflow endpoint, paginated run-scoped artifacts and exact named gh download', async t => {
  const options = harness(t);
  const calls = [];
  const summaries = [];
  const reports = await runCli({ argv: [options.outputDir], env: { GITHUB_REPOSITORY: repository, GH_TOKEN: 'test-token' },
    summary: message => summaries.push(message),
    gh: async args => {
      calls.push(args);
      if (args[0] === 'run') {
        writeArtifact(args[args.indexOf('--dir') + 1], 'web');
        return '';
      }
      return JSON.stringify(args.includes('--paginate') ? [{ artifacts: [artifact(run(), 'web')] }, { artifacts: [] }] : { workflow_runs: [run()] });
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].at(-1), `repos/${repository}/actions/workflows/quality-gates.yml/runs?branch=main&status=completed&per_page=20`);
  assert.deepEqual(calls[1].slice(0, 5), ['api', '--hostname', 'github.com', '--paginate', '--slurp']);
  assert.equal(calls[1].at(-1), `repos/${repository}/actions/runs/100/artifacts?per_page=100`);
  assert.deepEqual(calls[2].slice(0, 8), ['run', 'download', '100', '--repo', `github.com/${repository}`, '--name', 'quality-web-performance', '--dir']);
  assert.deepEqual(summaries, [`run=100 platform=web commit=${sha}`]);
  assert.equal(reports.length, 1);
  await assert.rejects(runCli({ argv: [], env: {} }), /Usage/);
  await assert.rejects(runCli({ argv: [options.outputDir], env: { GITHUB_REPOSITORY: repository } }), /GH_TOKEN/);
});

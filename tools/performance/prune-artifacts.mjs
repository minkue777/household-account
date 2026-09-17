import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const names = { web: 'quality-web-performance', android: 'quality-android-performance' };

function numericId(value) {
  if ((typeof value !== 'string' && typeof value !== 'number')
    || (typeof value === 'number' && !Number.isSafeInteger(value))
    || !/^[1-9][0-9]{0,19}$/.test(String(value))) throw new Error('Invalid GitHub numeric ID');
  return String(value);
}

function validateManifest(manifest) {
  if (!Array.isArray(manifest) || manifest.length < 1 || manifest.length > 2) throw new Error('Invalid report manifest');
  const selected = new Map();
  const ids = new Set();
  for (const report of manifest) {
    if (!report || typeof report.platform !== 'string' || !Object.hasOwn(names, report.platform) || selected.has(report.platform)
      || report.path !== `${report.platform}.html` || typeof report.commit !== 'string'
      || !/^[a-f0-9]{40}$/i.test(report.commit)) throw new Error('Invalid report manifest entry');
    const value = { ...report, runId: numericId(report.runId), artifactId: numericId(report.artifactId) };
    if (ids.has(value.artifactId)) throw new Error('Duplicate manifest artifact ID');
    selected.set(report.platform, value);
    ids.add(value.artifactId);
  }
  return selected;
}

/** Called only after deployment; keep each published source and every newer or unfinished run. */
export async function selectArtifactsToPrune({ repository, manifest, listArtifacts, getRun }) {
  if (typeof repository !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/.test(repository)
    || ['.', '..'].includes(repository.split('/')[1])) throw new Error('Invalid GitHub owner/repository');
  const selected = validateManifest(manifest);
  const protectedIds = new Set([...selected.values()].map(report => report.artifactId));
  const artifacts = await listArtifacts({ repository });
  if (!Array.isArray(artifacts)) throw new Error('Invalid GitHub artifact response');
  // A forged/stale manifest must not advance the deletion boundary without its published source.
  for (const [platform, report] of selected) {
    const sources = artifacts.filter(artifact => String(artifact?.id) === report.artifactId);
    const source = sources[0];
    if (sources.length !== 1 || source.name !== names[platform] || source.expired !== false
      || String(source.workflow_run?.id) !== report.runId || source.workflow_run?.head_branch !== 'main'
      || typeof source.workflow_run?.head_sha !== 'string'
      || source.workflow_run.head_sha.toLowerCase() !== report.commit.toLowerCase()) throw new Error('Published artifact provenance mismatch');
  }
  const runs = new Map();
  const deletions = new Map();
  for (const artifact of artifacts) {
    const platform = Object.keys(names).find(key => names[key] === artifact?.name);
    const latest = selected.get(platform);
    if (!latest || artifact.expired !== false || protectedIds.has(String(artifact.id))
      || artifact.workflow_run?.head_branch !== 'main') continue;
    const runId = numericId(artifact.workflow_run.id);
    if (BigInt(runId) >= BigInt(latest.runId)) continue;
    if (!runs.has(runId)) runs.set(runId, await getRun({ repository, runId }));
    const run = runs.get(runId);
    if (String(run?.id) !== runId || run.status !== 'completed' || run.head_branch !== 'main'
      || !['push', 'workflow_dispatch'].includes(run.event) || run.path !== '.github/workflows/quality-gates.yml'
      || typeof run.head_repository?.full_name !== 'string' || run.head_repository.full_name.toLowerCase() !== repository.toLowerCase()) continue;
    if (!Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 0) throw new Error('Invalid artifact size');
    const id = numericId(artifact.id);
    if (deletions.has(id)) throw new Error('Duplicate artifact ID');
    deletions.set(id, { id, name: artifact.name, bytes: artifact.size_in_bytes });
  }
  return [...deletions.values()];
}

export async function prunePerformanceArtifacts(options) {
  const selected = await selectArtifactsToPrune(options);
  for (const { id } of selected) await options.deleteArtifact({ repository: options.repository, artifactId: id });
  return selected;
}

export async function runCli({ argv = process.argv.slice(2), env = process.env, gh, summary = console.log } = {}) {
  if (argv.length !== 1) throw new Error('Usage: node tools/performance/prune-artifacts.mjs <manifest.json>');
  if (!env.GH_TOKEN?.trim()) throw new Error('GH_TOKEN is required');
  gh ??= async args => (await exec('gh', args, { encoding: 'utf8', env: { ...env, GH_PROMPT_DISABLED: '1' }, maxBuffer: 16 * 1024 * 1024 })).stdout;
  const deleted = await prunePerformanceArtifacts({ repository: env.GITHUB_REPOSITORY, manifest: JSON.parse(readFileSync(argv[0], 'utf8')),
    listArtifacts: async ({ repository }) => {
      const pages = JSON.parse(await gh(['api', '--hostname', 'github.com', '--paginate', '--slurp', `repos/${repository}/actions/artifacts?per_page=100`]));
      if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page?.artifacts))) throw new Error('Invalid GitHub artifact response');
      return pages.flatMap(page => page.artifacts);
    },
    getRun: async ({ repository, runId }) => JSON.parse(await gh(['api', '--hostname', 'github.com', `repos/${repository}/actions/runs/${runId}`])),
    deleteArtifact: async ({ repository, artifactId }) => gh(['api', '--hostname', 'github.com', '--method', 'DELETE', `repos/${repository}/actions/artifacts/${artifactId}`]),
  });
  summary(JSON.stringify(deleted));
  return deleted;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch(error => { console.error(error.message); process.exitCode = 1; });
}

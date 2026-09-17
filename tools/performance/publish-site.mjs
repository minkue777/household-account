import { execFile } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const platforms = [
  { name: 'web', artifact: 'quality-web-performance', locations: ['web'] },
  { name: 'android', artifact: 'quality-android-performance', locations: ['performance-results/android', 'android'] },
];
const exec = promisify(execFile);

function repositoryName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/[A-Za-z0-9_.-]{1,100}$/.test(value)
    || ['.', '..'].includes(value.split('/')[1])) throw new Error('Invalid GitHub owner/repository');
  return value;
}

function numericId(value) {
  if ((typeof value !== 'string' && typeof value !== 'number')
    || (typeof value === 'number' && !Number.isSafeInteger(value))
    || !/^[1-9][0-9]{0,19}$/.test(String(value))) throw new Error('Invalid GitHub numeric ID');
  return String(value);
}

function commitSha(value) {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{40}$/.test(value)) throw new Error('Invalid commit SHA');
  return value.toLowerCase();
}

function statIfPresent(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function childPath(root, path) {
  const target = resolve(root, path);
  const offset = relative(root, target);
  if (!offset || offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)) throw new Error('Path escapes its directory');
  return target;
}

function plainDirectories(path) {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of relative(current, absolute).split(sep).filter(Boolean)) {
    current = join(current, part);
    const entry = statIfPresent(current);
    if (entry && (entry.isSymbolicLink() || !entry.isDirectory())) throw new Error('Directory must not contain symbolic links or files');
  }
}

function outputDirectory(value) {
  if (typeof value !== 'string' || !value.trim() || value.startsWith('-')) throw new Error('An output directory is required');
  const output = resolve(value);
  const fromOutput = relative(output, process.cwd());
  if (output === parse(output).root || !fromOutput || (!fromOutput.startsWith(`..${sep}`) && fromOutput !== '..' && !isAbsolute(fromOutput))) {
    throw new Error('Output must not be the working directory or an ancestor');
  }
  plainDirectories(output);
  if (statIfPresent(output) && readdirSync(output).length > 0) throw new Error('Output directory must be empty');
  return output;
}

function artifactFile(root, path) {
  const file = childPath(root, path);
  plainDirectories(dirname(file));
  const entry = statIfPresent(file);
  if (!entry) return null;
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error('Report must be a regular file');
  return file;
}

function validateArtifact(artifact, run) {
  numericId(artifact.id);
  if (artifact.workflow_run !== undefined && artifact.workflow_run !== null) {
    const origin = artifact.workflow_run;
    if (numericId(origin.id) !== run.id || commitSha(origin.head_sha) !== run.commit || origin.head_branch !== 'main') {
      throw new Error(`Artifact provenance mismatch: ${run.id}/${artifact.name}`);
    }
  }
  // Without workflow_run, the authenticated run-scoped artifacts endpoint and
  // the unique artifact ID/name below establish the same run ownership.
}

function readReport(directory, platform, run) {
  const candidates = platform.locations.map(base => ({ base, html: artifactFile(directory, `${base}.html`) })).filter(item => item.html);
  if (!candidates.length) return null;
  if (candidates.length !== 1) throw new Error(`Ambiguous HTML report: ${run.id}/${platform.name}`);
  const { base, html } = candidates[0];
  const jsonPath = artifactFile(directory, `${base}.json`);
  if (!jsonPath) throw new Error(`Report JSON is missing: ${run.id}/${platform.name}`);
  const report = JSON.parse(readFileSync(jsonPath, 'utf8'));
  if (!Array.isArray(report?.performance?.results)) throw new Error(`Invalid performance JSON: ${run.id}/${platform.name}`);
  const hasCommit = Object.hasOwn(report, 'commit');
  if ((platform.name === 'web' || hasCommit) && commitSha(report.commit) !== run.commit) {
    throw new Error(`Report commit mismatch: ${run.id}/${platform.name}`);
  }
  const bytes = readFileSync(html);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const htmlCommit = text.match(/<dt>커밋<\/dt>\s*<dd>([^<]*)<\/dd>/)?.[1];
  if (htmlCommit !== undefined && commitSha(htmlCommit) !== run.commit) {
    throw new Error(`HTML commit mismatch: ${run.id}/${platform.name}`);
  }
  if (!/^\s*<!doctype html>\s*<html\b/i.test(text) || !/<body\b[^>]*>/i.test(text) || !/<\/body>\s*<\/html>\s*$/i.test(text)) {
    throw new Error(`Invalid standalone performance HTML: ${run.id}/${platform.name}`);
  }
  return { runId: run.id, platform: platform.name, commit: run.commit, path: `${platform.name}.html`, bytes };
}

/** Build only the allowlisted HTML files. Dependencies are read-only GitHub operations. */
export async function buildPerformanceSite({ repository, runs, outputDir, listArtifacts, downloadArtifact, temporaryRoot = tmpdir() }) {
  repository = repositoryName(repository);
  const output = outputDirectory(outputDir);
  if (!Array.isArray(runs)) throw new Error('Workflow runs must be an array');
  const selected = runs.filter(run => run?.status === 'completed' && run.head_branch === 'main'
    && ['push', 'workflow_dispatch'].includes(run.event)
    && run.head_repository?.full_name?.toLowerCase() === repository.toLowerCase())
    .map(run => ({ id: numericId(run.id), commit: commitSha(run.head_sha) }))
    .sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : BigInt(a.id) < BigInt(b.id) ? 1 : 0);
  if (new Set(selected.map(run => run.id)).size !== selected.length) throw new Error('Duplicate workflow run ID');
  const reports = [];
  const temporaryParent = resolve(temporaryRoot);
  plainDirectories(temporaryParent);
  for (const run of selected) {
    const artifacts = await listArtifacts({ repository, runId: run.id });
    if (!Array.isArray(artifacts)) throw new Error('Run artifacts must be an array');
    for (const platform of platforms) {
      if (reports.some(report => report.platform === platform.name)) continue;
      const available = artifacts.filter(artifact => artifact.name === platform.artifact && artifact.expired === false);
      if (!available.length) continue;
      if (available.length !== 1) throw new Error(`Duplicate performance artifact: ${run.id}/${platform.name}`);
      const artifact = available[0];
      validateArtifact(artifact, run);
      const directory = mkdtempSync(join(temporaryParent, 'household-performance-artifact-'));
      try {
        await downloadArtifact({ repository, runId: run.id, artifactId: String(artifact.id), artifactName: platform.artifact, destination: directory });
        const report = readReport(directory, platform, run);
        if (report) reports.push({ ...report, artifactId: numericId(artifact.id) });
      } finally {
        // Only remove the exact disposable child that this invocation created.
        rmSync(childPath(temporaryParent, relative(temporaryParent, directory)), { recursive: true, force: true });
      }
    }
    if (reports.length === platforms.length) break;
  }
  if (!reports.length) throw new Error('No publishable performance HTML reports');
  // Validate every source before writing output; invalid reports cannot publish a partial site.
  outputDirectory(output);
  mkdirSync(output, { recursive: true });
  for (const report of reports) {
    const destination = childPath(output, report.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, report.bytes, { flag: 'wx' });
  }
  writeFileSync(childPath(output, 'index.html'), (reports.find(report => report.platform === 'web') ?? reports[0]).bytes, { flag: 'wx' });
  writeFileSync(childPath(output, '.nojekyll'), '', { flag: 'wx' });
  return reports.map(({ bytes: _bytes, ...report }) => report);
}

export async function runCli({ argv = process.argv.slice(2), env = process.env, gh, summary = console.log } = {}) {
  if (argv.length !== 1) throw new Error('Usage: node tools/performance/publish-site.mjs <empty-output-directory>');
  const repository = repositoryName(env.GITHUB_REPOSITORY);
  if (!env.GH_TOKEN?.trim()) throw new Error('GH_TOKEN is required');
  gh ??= async args => (await exec('gh', args, { encoding: 'utf8', env: { ...env, GH_PROMPT_DISABLED: '1' }, maxBuffer: 16 * 1024 * 1024 })).stdout;
  const pages = JSON.parse(await gh(['api', '--hostname', 'github.com', '--paginate', '--slurp', `repos/${repository}/actions/workflows/quality-gates.yml/runs?branch=main&status=completed&per_page=100`]));
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page.workflow_runs))) throw new Error('Invalid GitHub workflow response');
  const runs = pages.flatMap(page => page.workflow_runs);
  const reports = await buildPerformanceSite({ repository, runs, outputDir: argv[0],
    listArtifacts: async ({ runId }) => {
      const pages = JSON.parse(await gh(['api', '--hostname', 'github.com', '--paginate', '--slurp', `repos/${repository}/actions/runs/${runId}/artifacts?per_page=100`]));
      if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page.artifacts))) throw new Error('Invalid GitHub artifact response');
      return pages.flatMap(page => page.artifacts);
    },
    downloadArtifact: async ({ runId, artifactName, destination }) => {
      await gh(['run', 'download', runId, '--repo', `github.com/${repository}`, '--name', artifactName, '--dir', destination]);
    },
  });
  // The deployment workflow keeps this manifest outside the public site and
  // uses it to preserve the exact published sources during post-deploy cleanup.
  summary(JSON.stringify(reports));
  return reports;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli().catch(error => { console.error(error.message); process.exitCode = 1; });
}

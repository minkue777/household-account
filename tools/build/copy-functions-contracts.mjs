import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const artifacts = [
  {
    source: 'contracts/fixtures/operations/scheduled-job-definitions.v1.json',
    target: 'functions/lib/contracts/operations/scheduled-job-definitions.v1.json',
  },
  {
    source: 'contracts/fixtures/operations/scheduled-jobs.v1.json',
    target: 'functions/lib/contracts/operations/scheduled-jobs.v1.json',
  },
];

for (const artifact of artifacts) {
  const source = resolve(repositoryRoot, artifact.source);
  const target = resolve(repositoryRoot, artifact.target);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
}

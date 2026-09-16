import { rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const functionsRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../functions');
const outputDirectory = resolve(functionsRoot, 'lib');

// tsc leaves output for deleted sources behind; a release must contain only this build.
if (relative(functionsRoot, outputDirectory) !== 'lib') {
  throw new Error('Unexpected Functions output directory');
}
await rm(outputDirectory, { recursive: true, force: true });

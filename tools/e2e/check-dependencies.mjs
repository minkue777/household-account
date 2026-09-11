import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const missing = [];
for (const codebase of ['functions-payment-capture', 'functions-access-session']) {
  const directory = resolve(root, codebase);
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(resolve(directory, 'package-lock.json'), 'utf8'));
  for (const dependency of Object.keys(manifest.dependencies)) {
    let installed;
    try { installed = JSON.parse(await readFile(resolve(directory, 'node_modules', dependency, 'package.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (installed?.version !== lock.packages?.[`node_modules/${dependency}`]?.version || !installed) {
      missing.push(codebase);
      break;
    }
  }
}
if (missing.length) {
  console.error('E2E Functions codebase 의존성이 준비되지 않았습니다. 저장소 루트에서 잠금파일대로 설치해 주세요:');
  for (const codebase of missing) console.error(`npm ci --prefix ${codebase}`);
  process.exitCode = 1;
}

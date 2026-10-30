import { readFile, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';

const defaults = {
  SHORTCUT_CREDENTIAL_PEPPER: 'emulator-only-not-a-production-secret',
  FUND_NAV_RELAY: "'{}'", // No production relay access from the Emulator.
};
const escapeValues = { n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"' };

function secretDefinition(contents, path, name) {
  // Preserve the original dotenv value when copying it to a missing codebase file.
  // Decode only for comparison, using Firebase CLI's quoted-value escape semantics.
  const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*('(?:\\\\'|[^'])*'|"(?:\\\\"|[^"])*"|[^#\\r\\n]*)[ \\t]*(?:#[^\\r\\n]*)?$`, 'gm');
  const definitions = [...contents.replaceAll('\r\n', '\n').matchAll(pattern)];
  if (definitions.length === 0 && name === 'FUND_NAV_RELAY') return undefined;
  if (definitions.length !== 1) throw new Error(`${basename(dirname(path))}/.secret.local에 ${name}를 한 번 정의해야 합니다. 기존 파일은 변경하지 않았습니다.`);
  const definition = definitions[0][1].trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(definition);
  const value = quoted
    ? quoted[1] === '"' ? quoted[2].replace(/\\([nrtv\\'"])/g, (_, character) => escapeValues[character]) : quoted[2]
    : definition;
  if (!value) throw new Error(`${basename(dirname(path))}/.secret.local의 ${name}가 비어 있습니다. 기존 파일은 변경하지 않았습니다.`);
  return { definition, value };
}

export async function withEmulatorSecrets(secretPaths, run) {
  if (secretPaths.length === 0) throw new Error('Emulator Secret 파일 경로가 필요합니다.');
  const lockPath = `${secretPaths.map(path => resolve(path)).sort()[0]}.run.lock`;
  const owner = JSON.stringify({ pid: process.pid, runId: randomUUID() });
  try {
    await writeFile(lockPath, owner, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`Emulator Secret 파일을 다른 실행이 사용 중입니다: ${lockPath}. 강제 종료 후 남은 잠금이라면 실행이 종료됐는지 확인한 뒤 직접 제거해 주세요.`);
    }
    throw error;
  }
  try {
    return await runWithSecretFiles(secretPaths, run);
  } finally {
    try { if (await readFile(lockPath, 'utf8') === owner) await rm(lockPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function runWithSecretFiles(secretPaths, run) {
  const existing = await Promise.all(secretPaths.map(async path => {
    try { return { path, contents: await readFile(path, 'utf8') }; }
    catch (error) { if (error.code === 'ENOENT') return { path }; throw error; }
  }));
  const definitions = {};
  for (const name of Object.keys(defaults)) {
    const values = existing.filter(entry => entry.contents !== undefined)
      .map(entry => secretDefinition(entry.contents, entry.path, name)).filter(Boolean);
    if (new Set(values.map(entry => entry.value)).size > 1) {
      throw new Error(`Functions codebase의 ${name}가 서로 다릅니다. 같은 Emulator용 값으로 맞춘 뒤 다시 실행해 주세요. 기존 파일은 변경하지 않았습니다.`);
    }
    definitions[name] = values[0]?.definition ?? defaults[name];
  }
  const contents = '# Generated temporarily by run-with-emulator-secret.mjs\n'
    + Object.entries(definitions).map(([name, value]) => `${name}=${value}\n`).join('');
  const owned = [];
  try {
    for (const entry of existing) {
      if (entry.contents !== undefined && secretDefinition(entry.contents, entry.path, 'FUND_NAV_RELAY')) continue;
      const generated = entry.contents === undefined ? contents
        : `${entry.contents}${entry.contents.endsWith('\n') ? '' : '\n'}FUND_NAV_RELAY=${definitions.FUND_NAV_RELAY}\n`;
      await writeFile(entry.path, generated, { encoding: 'utf8', flag: entry.contents === undefined ? 'wx' : 'w', mode: 0o600 });
      owned.push({ ...entry, generated });
    }
    return await run();
  } finally {
    for (const { path, contents: original, generated } of owned) {
      // Do not delete a file replaced by its caller while the command was running.
      try {
        if (await readFile(path, 'utf8') !== generated) continue;
        if (original === undefined) await rm(path);
        else await writeFile(path, original, 'utf8');
      }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

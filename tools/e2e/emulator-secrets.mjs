import { readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

const defaultDefinition = 'emulator-only-not-a-production-secret';
const escapeValues = { n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"' };

function pepperDefinition(contents, path) {
  // Preserve the original dotenv value when copying it to a missing codebase file.
  // Decode only for comparison, using Firebase CLI's quoted-value escape semantics.
  const definitions = [...contents.replaceAll('\r\n', '\n').matchAll(/^[ \t]*(?:export[ \t]+)?SHORTCUT_CREDENTIAL_PEPPER[ \t]*=[ \t]*('(?:\\'|[^'])*'|"(?:\\"|[^"])*"|[^#\r\n]*)[ \t]*(?:#[^\r\n]*)?$/gm)];
  if (definitions.length !== 1) throw new Error(`${basename(dirname(path))}/.secret.local에 SHORTCUT_CREDENTIAL_PEPPER를 한 번 정의해야 합니다. 기존 파일은 변경하지 않았습니다.`);
  const definition = definitions[0][1].trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(definition);
  const value = quoted
    ? quoted[1] === '"' ? quoted[2].replace(/\\([nrtv\\'"])/g, (_, character) => escapeValues[character]) : quoted[2]
    : definition;
  if (!value) throw new Error(`${basename(dirname(path))}/.secret.local의 SHORTCUT_CREDENTIAL_PEPPER가 비어 있습니다. 기존 파일은 변경하지 않았습니다.`);
  return { definition, value };
}

export async function withEmulatorSecrets(secretPaths, run) {
  const existing = await Promise.all(secretPaths.map(async path => {
    try { return { path, contents: await readFile(path, 'utf8') }; }
    catch (error) { if (error.code === 'ENOENT') return { path }; throw error; }
  }));
  const definitions = existing.filter(entry => entry.contents !== undefined)
    .map(entry => pepperDefinition(entry.contents, entry.path));
  if (new Set(definitions.map(entry => entry.value)).size > 1) {
    throw new Error('Functions codebase의 SHORTCUT_CREDENTIAL_PEPPER가 서로 다릅니다. 같은 Emulator용 값으로 맞춘 뒤 다시 실행해 주세요. 기존 파일은 변경하지 않았습니다.');
  }
  const contents = '# Generated temporarily by run-with-emulator-secret.mjs\n'
    + `SHORTCUT_CREDENTIAL_PEPPER=${definitions[0]?.definition ?? defaultDefinition}\n`;
  const owned = [];
  try {
    for (const entry of existing) {
      if (entry.contents !== undefined) continue;
      await writeFile(entry.path, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      owned.push(entry.path);
    }
    return await run();
  } finally {
    for (const path of owned) {
      // Do not delete a file replaced by its caller while the command was running.
      try { if (await readFile(path, 'utf8') === contents) await rm(path); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }
}

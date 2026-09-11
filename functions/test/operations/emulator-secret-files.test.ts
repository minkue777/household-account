import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-ignore 실제 E2E CLI가 사용하는 ESM 운영 도구에는 별도 declaration이 없습니다.
import { withEmulatorSecrets } from '../../../tools/e2e/emulator-secrets.mjs';

let directory: string;
let paths: string[];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'household-emulator-secrets-'));
  const codebases = ['functions', 'functions-payment-capture', 'functions-access-session'];
  await Promise.all(codebases.map(name => mkdir(join(directory, name))));
  paths = codebases.map(name => join(directory, name, '.secret.local'));
});
afterEach(async () => {
  if (!directory) return;
  expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
  expect(basename(directory)).toMatch(/^household-emulator-secrets-/);
  await rm(directory, { recursive: true, force: true });
});

it('실제 세 codebase 임시 파일을 같은 값으로 만들고 명령 실패에도 자신이 만든 파일만 정리한다', async () => {
  await expect(withEmulatorSecrets(paths, async () => {
    const contents = await Promise.all(paths.map(path => readFile(path, 'utf8')));
    expect(new Set(contents).size).toBe(1);
    expect(contents[0]).toContain('SHORTCUT_CREDENTIAL_PEPPER=emulator-only-not-a-production-secret');
    throw new Error('command failed');
  })).rejects.toThrow('command failed');
  for (const path of paths) await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('Windows CRLF의 기존 caller 값과 다른 secret을 그대로 보존하고 누락 codebase에 같은 pepper만 준비한다', async () => {
  const existing = '# caller-owned\r\nSHORTCUT_CREDENTIAL_PEPPER="same # pepper"\r\nOTHER_SECRET=caller-only\r\n';
  await writeFile(paths[0], existing);
  await writeFile(paths[1], "SHORTCUT_CREDENTIAL_PEPPER='same # pepper'\n");
  const result = await withEmulatorSecrets(paths, async () => {
    expect(await readFile(paths[0], 'utf8')).toBe(existing);
    const generated = await readFile(paths[2], 'utf8');
    expect(generated).toContain('SHORTCUT_CREDENTIAL_PEPPER="same # pepper"');
    expect(generated).not.toContain('OTHER_SECRET');
    return 42;
  });
  expect(result).toBe(42);
  expect(await readFile(paths[0], 'utf8')).toBe(existing);
  expect(await readFile(paths[1], 'utf8')).toContain("'same # pepper'");
  await expect(readFile(paths[2])).rejects.toMatchObject({ code: 'ENOENT' });
});

it('기존 pepper가 다르면 값 노출이나 파일 생성 없이 명령 실행을 거절한다', async () => {
  await writeFile(paths[0], 'SHORTCUT_CREDENTIAL_PEPPER=private-first\n');
  await writeFile(paths[1], 'SHORTCUT_CREDENTIAL_PEPPER=private-second\n');
  let executed = false;
  const failure = await withEmulatorSecrets(paths, () => { executed = true; }).catch((error: Error) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toContain('서로 다릅니다');
  expect(failure.message).not.toContain('private-first');
  expect(failure.message).not.toContain('private-second');
  expect(executed).toBe(false);
  await expect(readFile(paths[2])).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['OTHER_SECRET=untouched\n', 'SHORTCUT_CREDENTIAL_PEPPER=\n'])('기존 파일의 pepper 누락·공백은 덮어쓰기 없이 설명한다: %s', async existing => {
  await writeFile(paths[0], existing);
  await expect(withEmulatorSecrets(paths, () => {})).rejects.toThrow('기존 파일은 변경하지 않았습니다');
  expect(await readFile(paths[0], 'utf8')).toBe(existing);
  await expect(readFile(paths[1])).rejects.toMatchObject({ code: 'ENOENT' });
});

it('이전 실행이 남긴 dummy 파일과 실행 중 caller가 교체한 파일을 삭제하지 않는다', async () => {
  const previous = '# Generated temporarily by run-with-emulator-secret.mjs\nSHORTCUT_CREDENTIAL_PEPPER=emulator-only-not-a-production-secret\n';
  await writeFile(paths[0], previous);
  await withEmulatorSecrets(paths, async () => {
    await writeFile(paths[1], 'SHORTCUT_CREDENTIAL_PEPPER=new-caller-value\n');
  });
  expect(await readFile(paths[0], 'utf8')).toBe(previous);
  expect(await readFile(paths[1], 'utf8')).toContain('new-caller-value');
  await expect(readFile(paths[2])).rejects.toMatchObject({ code: 'ENOENT' });
});

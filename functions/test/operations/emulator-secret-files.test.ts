import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
// @ts-ignore 실제 E2E CLI가 사용하는 ESM 운영 도구에는 별도 declaration이 없습니다.
import { withEmulatorSecrets } from '../../../tools/e2e/emulator-secrets.mjs';

let directory: string;
let paths: string[];
function lockPath() { return `${paths.map(path => resolve(path)).sort()[0]}.run.lock`; }
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
    expect(contents[0]).toContain("FUND_NAV_RELAY='{}'");
    throw new Error('command failed');
  })).rejects.toThrow('command failed');
  for (const path of paths) await expect(readFile(path)).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(lockPath())).rejects.toMatchObject({ code: 'ENOENT' });
});

it('같은 파일 집합의 겹친 실행은 즉시 거절하고 첫 실행의 Secret을 유지한 뒤 다음 실행을 허용한다', async () => {
  const original = 'SHORTCUT_CREDENTIAL_PEPPER=fixture\n';
  for (const path of paths) await writeFile(path, original);
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const first = withEmulatorSecrets(paths, async () => { entered(); await hold; });
  try {
    await started;
    const owner = JSON.parse(await readFile(lockPath(), 'utf8'));
    expect(owner).toEqual({ pid: process.pid, runId: expect.any(String) });
    expect(Object.keys(owner)).toHaveLength(2);
    let secondRan = false;
    await expect(withEmulatorSecrets([...paths].reverse(), () => { secondRan = true; }))
      .rejects.toThrow('다른 실행이 사용 중입니다');
    expect(secondRan).toBe(false);
    expect(JSON.parse(await readFile(lockPath(), 'utf8'))).toEqual(owner);
    for (const path of paths) expect(await readFile(path, 'utf8')).toBe(`${original}FUND_NAV_RELAY='{}'\n`);
  } finally {
    release();
    await first;
  }
  await expect(readFile(lockPath())).rejects.toMatchObject({ code: 'ENOENT' });
  for (const path of paths) expect(await readFile(path, 'utf8')).toBe(original);
  await expect(withEmulatorSecrets(paths, async () => 42)).resolves.toBe(42);
  await expect(readFile(lockPath())).rejects.toMatchObject({ code: 'ENOENT' });
});

it('남아 있거나 외부에서 교체한 잠금은 자동 삭제하지 않는다', async () => {
  const abandoned = JSON.stringify({ pid: 999999999, runId: 'abandoned' });
  await writeFile(lockPath(), abandoned);
  let ran = false;
  await expect(withEmulatorSecrets(paths, () => { ran = true; })).rejects.toThrow('직접 제거해 주세요');
  expect(ran).toBe(false);
  expect(await readFile(lockPath(), 'utf8')).toBe(abandoned);
  await rm(lockPath());
  await withEmulatorSecrets(paths, async () => { await writeFile(lockPath(), abandoned); });
  expect(await readFile(lockPath(), 'utf8')).toBe(abandoned);
});

it('Windows CRLF의 기존 값을 보존하며 relay fixture만 임시 추가하고 종료 후 원문을 복원한다', async () => {
  const existing = '# caller-owned\r\nSHORTCUT_CREDENTIAL_PEPPER="same # pepper"\r\nOTHER_SECRET=caller-only\r\n';
  await writeFile(paths[0], existing);
  await writeFile(paths[1], "SHORTCUT_CREDENTIAL_PEPPER='same # pepper'\n");
  const result = await withEmulatorSecrets(paths, async () => {
    expect(await readFile(paths[0], 'utf8')).toBe(`${existing}FUND_NAV_RELAY='{}'\n`);
    const generated = await readFile(paths[2], 'utf8');
    expect(generated).toContain('SHORTCUT_CREDENTIAL_PEPPER="same # pepper"');
    expect(generated).not.toContain('OTHER_SECRET');
    expect(generated).toContain("FUND_NAV_RELAY='{}'");
    return 42;
  });
  expect(result).toBe(42);
  expect(await readFile(paths[0], 'utf8')).toBe(existing);
  expect(await readFile(paths[1], 'utf8')).toContain("'same # pepper'");
  await expect(readFile(paths[2])).rejects.toMatchObject({ code: 'ENOENT' });
});

it('caller relay 설정은 보존하고 누락 codebase에 복사하며 명령 실패에도 기존 파일을 복원한다', async () => {
  const relay = JSON.stringify({ url: 'https://relay.example.test/nav', token: 'fixture-only' });
  const configured = `SHORTCUT_CREDENTIAL_PEPPER=fixture\nFUND_NAV_RELAY='${relay}'\n`;
  const original = 'SHORTCUT_CREDENTIAL_PEPPER=fixture';
  await writeFile(paths[0], configured);
  await writeFile(paths[1], original);
  await expect(withEmulatorSecrets(paths, async () => {
    expect(await readFile(paths[0], 'utf8')).toBe(configured);
    expect(await readFile(paths[1], 'utf8')).toBe(`${original}\nFUND_NAV_RELAY='${relay}'\n`);
    expect(await readFile(paths[2], 'utf8')).toContain(`FUND_NAV_RELAY='${relay}'`);
    throw new Error('command failed');
  })).rejects.toThrow('command failed');
  expect(await readFile(paths[0], 'utf8')).toBe(configured);
  expect(await readFile(paths[1], 'utf8')).toBe(original);
  await expect(readFile(paths[2])).rejects.toMatchObject({ code: 'ENOENT' });
});

it('서로 다른 relay Secret은 원문 노출이나 파일 수정 없이 거절한다', async () => {
  const first = "SHORTCUT_CREDENTIAL_PEPPER=same\nFUND_NAV_RELAY='first-private'\n";
  await writeFile(paths[0], first);
  await writeFile(paths[1], "SHORTCUT_CREDENTIAL_PEPPER=same\nFUND_NAV_RELAY='second-private'\n");
  const failure = await withEmulatorSecrets(paths, () => { throw new Error('must not run'); }).catch((error: Error) => error);
  expect(failure.message).toContain('FUND_NAV_RELAY가 서로 다릅니다');
  expect(failure.message).not.toContain('private');
  expect(await readFile(paths[0], 'utf8')).toBe(first);
  await expect(readFile(paths[2])).rejects.toMatchObject({ code: 'ENOENT' });
  await expect(readFile(lockPath())).rejects.toMatchObject({ code: 'ENOENT' });
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

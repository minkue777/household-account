import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const root = resolve(__dirname, '../../..');
const script = join(root, 'functions/scripts/prepare-smoke-session.cjs');

describe('[REL-001] 실제 배포 로그인 준비 CLI의 자격 저장 경계', () => {
  it.each(['.smoke.id-token', '..smoke.id-token'])(
    '저장소 안의 %s 경로는 인증 전에 거부한다', tokenName => {
      const result = spawnSync(process.execPath, [script, '--token-file', join(root, tokenName)], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stderr)).toEqual({ code: 'SMOKE_TOKEN_MUST_BE_OUTSIDE_REPOSITORY' });
    });

  it('출력 파일을 지정하지 않으면 로그인 서버를 열지 않는다', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ code: 'SMOKE_TOKEN_FILE_REQUIRED' });
  });

  it('에뮬레이터 인증을 운영 배포 인증으로 준비하지 않는다', () => {
    const result = spawnSync(process.execPath, [script, '--token-file', join(tmpdir(), 'smoke-cli-test.id-token')], {
      encoding: 'utf8', env: { ...process.env, FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toEqual({ code: 'PRODUCTION_EMULATOR_MIXED' });
  });
});

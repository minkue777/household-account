import { describe, expect, it, vi } from 'vitest';
import { androidInstrumentationScope } from '../../../tools/ci/android-instrumentation-scope.mjs';

const before = 'a'.repeat(40);
const after = 'b'.repeat(40);
const push = { before, after };

describe('Android 에뮬레이터 검증의 변경 범위', () => {
  it.each([
    'web/src/components/settings/CategorySettings.tsx',
    'web/src/components/common/ColorPicker.tsx',
    'web/src/components/settings/useCategoryReorder.ts',
    'web/src/app/globals.css',
    'web/e2e/pwa-authenticated.spec.ts',
    'web/playwright.pwa.config.ts',
    'docs/operations/deployment-prerequisites.md',
    'AGENTS.md',
  ])('Web 표시·문서 변경은 에뮬레이터를 요구하지 않는다: %s', path => {
    expect(androidInstrumentationScope('push', push, () => `${path}\0`).required).toBe(false);
  });

  it.each([
    'android/app/src/main/java/com/household/account/MainActivity.kt',
    'android/app/build.gradle.kts',
    'android/gradle/wrapper/gradle-wrapper.properties',
    'contracts/schemas/system/household-command.v1.schema.json',
    'web/src/platform/android-host/androidHostBridge.ts',
    'web/src/lib/bridges/androidBridge.ts',
    'web/src/lib/authService.ts',
    'web/src/lib/firebase.ts',
    'web/e2e/native-quick-edit.spec.ts',
    'web/playwright.native.config.ts',
    'tools/e2e/native-firebase.mjs',
    'tools/e2e/native-web-runtime.mjs',
  ])('Android 코드·의존성·계약·연동과 Native E2E 변경을 검증한다: %s', path => {
    expect(androidInstrumentationScope('push', push, () => `${path}\0`).required).toBe(true);
  });

  it('마지막 커밋만 보지 않고 push 전체를 비교하며 Android 경로 삭제도 포함한다', () => {
    const git = vi.fn(() => 'android/old.kt\0web/renamed.ts\0web/src/app/globals.css\0');
    expect(androidInstrumentationScope('push', push, git).required).toBe(true);
    expect(git).toHaveBeenCalledWith(['diff', '--no-renames', '--name-only', '-z', before, after]);
  });

  it('PR은 대상 브랜치 자체의 변경이 아닌 공통 조상 이후 변경을 비교한다', () => {
    const ancestor = 'c'.repeat(40);
    const git = vi.fn()
      .mockReturnValueOnce(`${ancestor}\n`)
      .mockReturnValueOnce('web/src/components/settings/CategorySettings.tsx\0');
    const event = { pull_request: { base: { sha: before }, head: { sha: after } } };
    expect(androidInstrumentationScope('pull_request', event, git).required).toBe(false);
    expect(git).toHaveBeenNthCalledWith(1, ['merge-base', before, after]);
    expect(git).toHaveBeenNthCalledWith(2, ['diff', '--no-renames', '--name-only', '-z', ancestor, after]);
  });

  it('첫 push는 전체 파일을 확인하고 수동 실행은 전체 에뮬레이터 검증을 요구한다', () => {
    const git = vi.fn(() => 'android/app/build.gradle.kts\0');
    expect(androidInstrumentationScope('push', { before: '0'.repeat(40), after }, git).required).toBe(true);
    expect(git).toHaveBeenCalledWith(['ls-tree', '-r', '--name-only', '-z', after]);
    git.mockClear();
    expect(androidInstrumentationScope('workflow_dispatch', {}, git).required).toBe(true);
    expect(git).not.toHaveBeenCalled();
  });

  it('비교 범위를 알 수 없거나 git 조회가 실패하면 검증 불필요로 처리하지 않는다', () => {
    expect(() => androidInstrumentationScope('push', { after })).toThrow('ANDROID_SCOPE_COMMIT_REQUIRED');
    expect(() => androidInstrumentationScope('unknown', push)).toThrow('ANDROID_SCOPE_EVENT_UNSUPPORTED');
    expect(() => androidInstrumentationScope('push', push, () => { throw new Error('git failed'); }))
      .toThrow('git failed');
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { isLauncherFocused, prepareAndroidUi } from './prepare-android-ui.mjs';

const ready = '  mCurrentFocus=Window{73f u0 com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity}';
const launcherAnr = '  mCurrentFocus=Window{12a u0 Application Not Responding: com.google.android.apps.nexuslauncher}';
// Selected verbatim lines from CI 35336068255's Android 14 "dumpsys window windows".
// A visible HOME and its IME targets cannot establish current input focus.
const windowListWithoutFocus = `WINDOW MANAGER WINDOWS (dumpsys window windows)
  Window #10 Window{e6a0f3f u0 com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity}:
  mTopFocusedDisplayId=0
  imeInputTarget in display# 0 Window{e6a0f3f u0 com.google.android.apps.nexuslauncher/com.google.android.apps.nexuslauncher.NexusLauncherActivity}
  mSystemBooted=true mDisplayEnabled=true`;

test('HOME 배경이 있어도 ANR dialog 또는 다른 창이 입력을 점유하면 준비 완료로 판단하지 않습니다', () => {
  assert.equal(isLauncherFocused(ready), true);
  assert.equal(isLauncherFocused(`${launcherAnr}\nWindow #1 ${ready.slice(16)}`), false);
  assert.equal(isLauncherFocused('mCurrentFocus=null'), false);
  assert.equal(isLauncherFocused('mCurrentFocus=Window{12a u0 Application Not Responding: com.household.account}'), false);
  assert.equal(isLauncherFocused('mCurrentFocus=Window{12a u0 com.android.permissioncontroller/.GrantPermissionsActivity}'), false);
  assert.equal(isLauncherFocused(windowListWithoutFocus), false);
});

test('실제 CI처럼 windows에 focus가 없어도 display 조회로 현재 입력 창을 판정합니다', async () => {
  let time = 0;
  const calls = [];
  const displays = `WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)\nDisplay: mDisplayId=0\n${ready}`;
  const saved = new Map();
  await prepareAndroidUi({
    adb: args => {
      calls.push(args);
      if (args.join(' ') === 'shell dumpsys window windows') return windowListWithoutFocus;
      if (args.join(' ') === 'shell dumpsys window displays') return displays;
      return '';
    },
    save: (name, value) => saved.set(name, value),
    wait: async milliseconds => { time += milliseconds; },
    now: () => time,
  });
  assert.equal(saved.get('windows-ready.txt'), displays);
  assert.equal(time, 0);
  assert.deepEqual(calls.filter(args => args.includes('dumpsys')), [
    ['shell', 'dumpsys', 'window', 'displays'],
    ['shell', 'dumpsys', 'window', 'displays'],
  ]);
});

test('부팅 launcher만 재시작하고 실제 HOME focus를 얻은 뒤 앱 테스트에 넘깁니다', async () => {
  const calls = [];
  const saved = new Map();
  const windows = [launcherAnr, 'mCurrentFocus=null', ready];
  await prepareAndroidUi({
    adb: args => { calls.push(args); return args.includes('dumpsys') ? windows.shift() : ''; },
    save: (name, value) => saved.set(name, value),
    wait: async () => {},
  });
  assert.deepEqual(calls.filter(args => args.includes('force-stop')), [
    ['shell', 'am', 'force-stop', 'com.google.android.apps.nexuslauncher'],
  ]);
  assert.equal(calls.some(args => args.includes('com.household.account')), false);
  assert.equal(saved.get('windows-before.txt'), launcherAnr);
  assert.equal(saved.get('windows-ready.txt'), ready);
});

test('ANR가 남으면 진단을 보관하고 실패시키며 테스트를 우회하지 않습니다', async () => {
  let time = 0;
  const saved = new Map();
  await assert.rejects(prepareAndroidUi({
    adb: args => args.includes('dumpsys') ? launcherAnr : '',
    save: (name, value) => saved.set(name, value),
    wait: async milliseconds => { time += milliseconds; },
    now: () => time,
  }), /ANDROID_EMULATOR_HOME_NOT_FOCUSED/);
  assert.equal(saved.get('windows-not-ready.txt'), launcherAnr);
  assert.equal(saved.has('windows-ready.txt'), false);
});

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const launcherPackage = 'com.google.android.apps.nexuslauncher';

export function isLauncherFocused(windows) {
  const focus = windows.split('\n').find(line => /^\s*mCurrentFocus=/.test(line)) ?? '';
  return !/Application (?:Not Responding|Error):/i.test(focus)
    && focus.includes(`${launcherPackage}/`);
}

/** Prepare only the CI emulator's HOME window, before any application test runs. */
export async function prepareAndroidUi({
  adb = args => execFileSync('adb', args, { encoding: 'utf8', timeout: 15_000 }),
  save = () => {},
  wait = delay,
  now = Date.now,
} = {}) {
  // Android 14 emits mCurrentFocus from DisplayContent.dump, not the "windows" section.
  // Keep the acquisition and parser on the same dump contract.
  const readFocus = () => adb(['shell', 'dumpsys', 'window', 'displays']);
  save('windows-before.txt', readFocus());
  // Google APIs API 34 can leave a Pixel Launcher boot ANR above every app.
  // Restart that package alone; never dismiss an ANR belonging to the tested app.
  adb(['shell', 'am', 'force-stop', launcherPackage]);
  adb(['shell', 'am', 'start', '-W', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.HOME']);
  const deadline = now() + 10_000;
  let windows;
  do {
    windows = readFocus();
    if (isLauncherFocused(windows)) {
      save('windows-ready.txt', windows);
      return;
    }
    await wait(100);
  } while (now() < deadline);
  save('windows-not-ready.txt', windows);
  throw new Error('ANDROID_EMULATOR_HOME_NOT_FOCUSED: 에뮬레이터 HOME 창이 입력을 받을 수 없습니다. 앱 테스트를 시작하지 않습니다.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve('android/app/build/ci-diagnostics');
  mkdirSync(directory, { recursive: true });
  await prepareAndroidUi({ save: (name, value) => writeFileSync(resolve(directory, name), value) });
  console.log('Android 에뮬레이터 HOME 입력 포커스 확인 완료');
}

import { devices, expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const AUTH_API_SCRIPT = /https:\/\/apis\.google\.com\/js\/api\.js\?onload=__iframefcb/;

async function completeGooglePopup(page: Page): Promise<void> {
  const email = `google-popup-${randomUUID()}@household.test`;
  // iOS standalone은 anchor로 새 탭을 열어 opener가 없는 브라우저도 있습니다.
  const popupOpened = page.context().waitForEvent('page');
  await page.getByRole('button', { name: 'Google로 로그인', exact: true }).click();
  const popup = await popupOpened;
  await expect(popup).toHaveURL(/127\.0\.0\.1:9099\/emulator\/auth\/handler\?/);
  // Emulator는 정적 폼 뒤 외부 스크립트를 읽은 다음 클릭 핸들러를 연결합니다.
  await popup.waitForLoadState('domcontentloaded');
  expect(new URL(popup.url()).searchParams.get('providerId')).toBe('google.com');
  await popup.getByRole('button', { name: 'Add new account', exact: true }).click();
  await popup.locator('#email-input').fill(email);
  await popup.locator('#display-name-input').fill('Google 로그인 검사');
  const signedIn = page.waitForResponse(response =>
    response.url().includes('/accounts:signInWithIdp') && response.request().method() === 'POST');
  await popup.getByRole('button', { name: 'Sign in with Google.com', exact: true }).click();
  const response = await signedIn;
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ email, providerId: 'google.com' });

  // /admin은 E2E 모드에서도 실제 Google 팝업 서비스 경로를 사용합니다.
  // 신규 계정에는 관리자 권한을 부여하지 않으며 일반 홈에서도 같은 인증을 복원합니다.
  await expect(page.getByRole('heading', { name: '접근 권한 없음', exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('button', { name: '새 가계부 만들기', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '테스트 계정으로 로그인', exact: true })).toHaveCount(0);
}

test.describe('실제 Google Auth Emulator 팝업', () => {
  // WebKit은 iPhone, Chromium은 모바일 Chrome으로 실행합니다.
  // Chromium에 iOS standalone을 강제하면 실제로 없는 플랫폼 조합이 됩니다.
  test.use({
    userAgent: async ({ browserName }, use) => use(devices[browserName === 'webkit' ? 'iPhone 13' : 'Pixel 7'].userAgent),
    viewport: devices['iPhone 13'].viewport,
  });

  test('[T-HH-002][HH-003][HH-008] 모바일 브라우저와 iPhone PWA는 로그인 버튼 전에 팝업 SDK를 준비하고 Google 로그인 후 일반 홈에 인증을 복원한다', async ({ page, browserName }) => {
    if (browserName === 'webkit') {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true });
      });
    }
    let apiRequested = false;
    let iframeStatus: number | undefined;
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/emulator/auth/iframe') {
        iframeStatus = response.status();
      }
    });
    let releaseApi!: () => void;
    const apiGate = new Promise<void>(resolve => { releaseApi = resolve; });
    await page.route(AUTH_API_SCRIPT, async route => {
      apiRequested = true;
      await apiGate;
      await route.continue();
    });

    try {
      await page.goto('/admin', { waitUntil: 'domcontentloaded' });
      await expect.poll(() => apiRequested, {
        message: '사용자가 누르기 전에 실제 Firebase 팝업 SDK를 요청해야 합니다.',
      }).toBe(true);
      await expect(page.getByRole('button', { name: 'Google로 로그인', exact: true })).toHaveCount(0);
    } finally {
      releaseApi();
    }
    await expect.poll(() => iframeStatus, { message: '실제 Auth Emulator iframe의 응답을 확인합니다.' }).toBe(200);
    await expect(page.getByRole('button', { name: 'Google로 로그인', exact: true })).toBeVisible();
    await completeGooglePopup(page);
  });

  test('[T-HH-002][HH-003][HH-008] 브라우저에서 Google 로그인 창을 닫은 뒤 다시 로그인할 수 있다', async ({ page }) => {
    await page.goto('/admin');
    const popupOpened = page.waitForEvent('popup');
    await page.getByRole('button', { name: 'Google로 로그인', exact: true }).click();
    const popup = await popupOpened;
    await popup.waitForLoadState('domcontentloaded');
    await expect(popup.getByRole('button', { name: 'Add new account', exact: true })).toBeVisible();
    await popup.close();
    await completeGooglePopup(page);
  });
});

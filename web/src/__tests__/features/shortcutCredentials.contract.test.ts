import { shortcutAuthorizationValue } from '@/features/payment-capture/application/shortcutCredentials';

describe('iPhone 단축어 설치 인증값 계약', () => {
  it('가져오기 질문에 붙여넣을 값은 Authorization 헤더 전체다', () => {
    const credential = 'hca-shortcut.v1.credential-id.secret';

    expect(shortcutAuthorizationValue(credential)).toBe(`Bearer ${credential}`);
  });
});

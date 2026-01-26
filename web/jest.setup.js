import '@testing-library/jest-dom';

// 브라우저 환경에서만 mock 적용
if (typeof window !== 'undefined') {
  // navigator vibrate mock
  Object.defineProperty(window.navigator, 'vibrate', {
    value: jest.fn(),
    writable: true,
  });
}

const nextJest = require('next/jest');

const createJestConfig = nextJest({
  // Next.js 앱의 경로
  dir: './',
});

/** @type {import('jest').Config} */
const customJestConfig = {
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testPathIgnorePatterns: ['<rootDir>/node_modules/', '<rootDir>/.next/'],
  collectCoverageFrom: [
    'src/**/*.{js,jsx,ts,tsx}',
    '!src/**/*.d.ts',
    '!src/app/**', // 페이지는 E2E 테스트로
    '!src/components/**', // 컴포넌트는 별도 설정 필요
    '!src/types/index.ts', // 타입 re-export
    '!src/hooks/index.ts', // 훅 re-export
    '!src/data/**', // 샘플 데이터
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};

module.exports = createJestConfig(customJestConfig);

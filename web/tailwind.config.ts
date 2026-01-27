import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // 카테고리 색상
        'category-living': '#4ADE80',    // 생활비 - 초록
        'category-childcare': '#F472B6', // 육아비 - 핑크
        'category-fixed': '#60A5FA',     // 고정비 - 파랑
        'category-food': '#FBBF24',      // 식비 - 노랑
        'category-etc': '#9CA3AF',       // 기타 - 회색
      },
      keyframes: {
        slideDown: {
          '0%': {
            opacity: '0',
            transform: 'translateY(-8px) scale(0.98)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0) scale(1)',
          },
        },
        slideLeft: {
          '0%': {
            opacity: '0',
            transform: 'translateX(30px)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateX(0)',
          },
        },
        slideRight: {
          '0%': {
            opacity: '0',
            transform: 'translateX(-30px)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateX(0)',
          },
        },
        flipPage: {
          '0%': {
            transform: 'rotateX(0deg)',
            transformOrigin: 'top',
          },
          '100%': {
            transform: 'rotateX(-180deg)',
            transformOrigin: 'top',
          },
        },
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%': { transform: 'translateX(-4px)' },
          '40%': { transform: 'translateX(4px)' },
          '60%': { transform: 'translateX(-4px)' },
          '80%': { transform: 'translateX(4px)' },
        },
      },
      animation: {
        slideDown: 'slideDown 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards',
        slideLeft: 'slideLeft 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards',
        slideRight: 'slideRight 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards',
        flipPage: 'flipPage 0.6s ease-in-out forwards',
        shake: 'shake 0.3s ease-in-out',
      },
    },
  },
  plugins: [],
}
export default config

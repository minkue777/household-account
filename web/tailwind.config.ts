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
        pageNext: {
          '0%': {
            opacity: '0',
            transform: 'translateY(-20px)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
        pagePrev: {
          '0%': {
            opacity: '0',
            transform: 'translateY(20px)',
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0)',
          },
        },
      },
      animation: {
        slideDown: 'slideDown 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards',
        pageNext: 'pageNext 0.3s ease-out forwards',
        pagePrev: 'pagePrev 0.3s ease-out forwards',
      },
    },
  },
  plugins: [],
}
export default config

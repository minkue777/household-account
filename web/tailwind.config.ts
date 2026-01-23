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
        flipUp: {
          '0%': {
            opacity: '0',
            transform: 'perspective(1000px) rotateX(60deg)',
            transformOrigin: 'bottom center',
          },
          '100%': {
            opacity: '1',
            transform: 'perspective(1000px) rotateX(0deg)',
            transformOrigin: 'bottom center',
          },
        },
        flipDown: {
          '0%': {
            opacity: '0',
            transform: 'perspective(1000px) rotateX(-60deg)',
            transformOrigin: 'top center',
          },
          '100%': {
            opacity: '1',
            transform: 'perspective(1000px) rotateX(0deg)',
            transformOrigin: 'top center',
          },
        },
      },
      animation: {
        slideDown: 'slideDown 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards',
        flipUp: 'flipUp 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards',
        flipDown: 'flipDown 0.4s cubic-bezier(0.4, 0, 0.2, 1) forwards',
      },
    },
  },
  plugins: [],
}
export default config

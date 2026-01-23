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
            transform: 'translateY(-10px)',
            maxHeight: '0'
          },
          '100%': {
            opacity: '1',
            transform: 'translateY(0)',
            maxHeight: '1000px'
          },
        },
      },
      animation: {
        slideDown: 'slideDown 0.3s ease-out forwards',
      },
    },
  },
  plugins: [],
}
export default config

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
    },
  },
  plugins: [],
}
export default config

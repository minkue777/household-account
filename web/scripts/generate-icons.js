// PWA 아이콘 생성 스크립트
// 실행: node scripts/generate-icons.js

const fs = require('fs');
const path = require('path');

// 간단한 PNG 생성 (단색 배경 + 텍스트)
// Canvas 없이 간단한 SVG를 PNG로 변환하는 것은 복잡하므로
// 여기서는 기존 이미지를 복사하거나 placeholder를 사용

const iconsDir = path.join(__dirname, '../public/icons');

// icons 폴더가 없으면 생성
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// 기존 곰돌이 이미지 경로
const bearImage = path.join(__dirname, '../public/bear-removebg-preview.png');

// 곰돌이 이미지가 있으면 복사 (임시로 사용)
if (fs.existsSync(bearImage)) {
  fs.copyFileSync(bearImage, path.join(iconsDir, 'icon-192x192.png'));
  fs.copyFileSync(bearImage, path.join(iconsDir, 'icon-512x512.png'));
  console.log('아이콘이 생성되었습니다. (곰돌이 이미지 사용)');
  console.log('참고: 정식 아이콘은 192x192, 512x512 크기로 별도 제작 권장');
} else {
  console.log('곰돌이 이미지를 찾을 수 없습니다.');
  console.log('public/icons 폴더에 icon-192x192.png, icon-512x512.png를 직접 추가해주세요.');
}

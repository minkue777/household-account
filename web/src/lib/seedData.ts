import { collection, addDoc, Timestamp } from 'firebase/firestore';
import { db } from './firebase';

const COLLECTION_NAME = 'expenses';

interface SampleExpense {
  date: string;
  time: string;
  merchant: string;
  amount: number;
  category: string;
  cardType: string;
  cardLastFour: string;
  memo: string;
}

// 가맹점 목록
const merchants = {
  food: ['스타벅스', '이디야커피', '맥도날드', '버거킹', 'GS25', 'CU편의점', '배달의민족', '쿠팡이츠', '교촌치킨', '네네치킨', '도미노피자', '파리바게뜨', '뚜레쥬르', '김밥천국', '롯데리아'],
  living: ['다이소', '이마트', '홈플러스', '쿠팡', 'SSG닷컴', '올리브영', '롯데마트', '코스트코', 'GS수퍼마켓', '하나로마트'],
  baby: ['맘스터치', '베이비플러스', '아이사랑어린이집', '토이저러스', '아가방', '보리보리', '하기스', '뽀로로키즈카페'],
  transport: ['카카오택시', '타다', 'SK주유소', 'GS칼텍스', '고속버스터미널', 'SRT', 'KTX', '서울메트로', 'T머니충전'],
  medical: ['서울약국', '온누리약국', '서울대병원', '강남세브란스', '연세치과', '바른치과', '밝은안과', '이비인후과'],
  etc: ['네이버페이', '카카오페이', 'CGV', '롯데시네마', '교보문고', '영풍문고', 'YES24', '넷플릭스', '유튜브프리미엄', '멜론'],
};

// 랜덤 시간 생성
function randomTime(): string {
  const hour = Math.floor(Math.random() * 14) + 8; // 8시 ~ 22시
  const minute = Math.floor(Math.random() * 60);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// 카테고리별 금액 범위
const amountRanges: Record<string, [number, number]> = {
  food: [3000, 50000],
  living: [5000, 150000],
  baby: [10000, 100000],
  transport: [1500, 80000],
  medical: [5000, 200000],
  etc: [5000, 50000],
};

// 랜덤 금액 생성 (100원 단위)
function randomAmount(category: string): number {
  const [min, max] = amountRanges[category] || [5000, 50000];
  const amount = Math.floor(Math.random() * (max - min) + min);
  return Math.round(amount / 100) * 100;
}

// 랜덤 가맹점 선택
function randomMerchant(category: string): string {
  const list = merchants[category as keyof typeof merchants] || merchants.etc;
  return list[Math.floor(Math.random() * list.length)];
}

// 랜덤 카테고리 선택 (가중치 적용)
function randomCategory(): string {
  const weights = [
    { category: 'food', weight: 35 },
    { category: 'living', weight: 25 },
    { category: 'baby', weight: 15 },
    { category: 'transport', weight: 12 },
    { category: 'medical', weight: 5 },
    { category: 'etc', weight: 8 },
  ];

  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  let random = Math.random() * total;

  for (const { category, weight } of weights) {
    random -= weight;
    if (random <= 0) return category;
  }
  return 'etc';
}

// 월별 지출 횟수 (15~40회)
function getMonthlyExpenseCount(): number {
  return Math.floor(Math.random() * 26) + 15;
}

// 해당 월의 랜덤 날짜 생성
function randomDateInMonth(year: number, month: number): string {
  const daysInMonth = new Date(year, month, 0).getDate();
  const day = Math.floor(Math.random() * daysInMonth) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// 샘플 데이터 생성
export function generateSampleData(): SampleExpense[] {
  const samples: SampleExpense[] = [];

  // 2025년 1월 ~ 12월
  for (let month = 1; month <= 12; month++) {
    const count = getMonthlyExpenseCount();
    for (let i = 0; i < count; i++) {
      const category = randomCategory();
      samples.push({
        date: randomDateInMonth(2025, month),
        time: randomTime(),
        merchant: randomMerchant(category),
        amount: randomAmount(category),
        category,
        cardType: Math.random() > 0.3 ? 'main' : 'spouse',
        cardLastFour: Math.random() > 0.5 ? '1234' : '5678',
        memo: '',
      });
    }
  }

  // 2026년 1월
  const count2026 = getMonthlyExpenseCount();
  for (let i = 0; i < count2026; i++) {
    const category = randomCategory();
    samples.push({
      date: randomDateInMonth(2026, 1),
      time: randomTime(),
      merchant: randomMerchant(category),
      amount: randomAmount(category),
      category,
      cardType: Math.random() > 0.3 ? 'main' : 'spouse',
      cardLastFour: Math.random() > 0.5 ? '1234' : '5678',
      memo: '',
    });
  }

  return samples;
}

// Firebase에 샘플 데이터 추가
export async function seedSampleData(): Promise<number> {
  const samples = generateSampleData();
  let count = 0;

  for (const sample of samples) {
    try {
      await addDoc(collection(db, COLLECTION_NAME), {
        ...sample,
        createdAt: Timestamp.now(),
      });
      count++;
    } catch (error) {
      console.error('샘플 데이터 추가 실패:', error);
    }
  }

  console.log(`${count}개의 샘플 데이터가 추가되었습니다.`);
  return count;
}

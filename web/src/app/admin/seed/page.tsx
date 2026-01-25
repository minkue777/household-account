'use client';

import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { collection, addDoc, Timestamp, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { createHousehold, validateHouseholdKey } from '@/lib/householdService';
import { onAuthChange, isAdmin } from '@/lib/authService';

const GUEST_KEY = 'guest';
const GUEST_NAME = '샘플 가계부';

// 반복 사용할 가맹점 템플릿
const EXPENSE_TEMPLATES = [
  // 식비
  { merchant: '스타벅스', amount: [5500, 6500, 7000], category: 'food' },
  { merchant: '이마트', amount: [45000, 87000, 120000], category: 'food' },
  { merchant: '배달의민족', amount: [18000, 28000, 35000], category: 'food' },
  { merchant: 'GS25', amount: [2500, 3500, 5000], category: 'food' },
  { merchant: '맥도날드', amount: [12000, 15500, 22000], category: 'food' },
  { merchant: '카페', amount: [4500, 5500, 6000], category: 'food' },
  { merchant: '홈플러스', amount: [35000, 55000, 78000], category: 'food' },
  { merchant: '쿠팡이츠', amount: [15000, 25000, 32000], category: 'food' },
  // 생활비
  { merchant: '쿠팡', amount: [25000, 45000, 89000], category: 'living' },
  { merchant: '주유소', amount: [60000, 80000, 95000], category: 'living' },
  { merchant: '다이소', amount: [8000, 12000, 18000], category: 'living' },
  { merchant: '올리브영', amount: [25000, 35000, 55000], category: 'living' },
  { merchant: '주차비', amount: [3000, 5000, 8000], category: 'living' },
  { merchant: '세탁소', amount: [8000, 15000, 25000], category: 'living' },
  // 고정비
  { merchant: '넷플릭스', amount: [17000], category: 'fixed' },
  { merchant: '통신비', amount: [55000], category: 'fixed' },
  { merchant: '관리비', amount: [150000, 180000, 210000], category: 'fixed' },
  { merchant: '보험료', amount: [120000], category: 'fixed' },
  { merchant: '인터넷', amount: [33000], category: 'fixed' },
  // 육아비
  { merchant: '어린이집', amount: [450000], category: 'childcare' },
  { merchant: '아기용품', amount: [45000, 78000, 120000], category: 'childcare' },
  { merchant: '소아과', amount: [15000, 25000, 35000], category: 'childcare' },
  { merchant: '장난감', amount: [25000, 45000, 65000], category: 'childcare' },
  // 기타
  { merchant: '병원', amount: [15000, 35000, 55000], category: 'etc' },
  { merchant: '교보문고', amount: [15000, 22000, 35000], category: 'etc' },
  { merchant: '약국', amount: [5500, 8500, 15000], category: 'etc' },
  { merchant: '미용실', amount: [15000, 25000, 35000], category: 'etc' },
];

// 2025년 1월부터 2026년 1월까지 데이터 생성
function generateSampleExpenses() {
  const expenses: { merchant: string; amount: number; category: string; date: string }[] = [];

  const startDate = new Date('2025-01-01');
  const endDate = new Date('2026-01-25');

  // 각 월마다 15~25개 지출 생성
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const expensesThisMonth = 15 + Math.floor(Math.random() * 11); // 15~25개

    // 고정비는 매월 초에 추가
    const fixedExpenses = EXPENSE_TEMPLATES.filter(t => t.category === 'fixed');
    for (const template of fixedExpenses) {
      const day = 1 + Math.floor(Math.random() * 10);
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const amount = template.amount[Math.floor(Math.random() * template.amount.length)];
      expenses.push({ merchant: template.merchant, amount, category: template.category, date });
    }

    // 어린이집은 매월 추가
    const childcareFixed = EXPENSE_TEMPLATES.find(t => t.merchant === '어린이집');
    if (childcareFixed) {
      const day = 5 + Math.floor(Math.random() * 5);
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      expenses.push({ merchant: childcareFixed.merchant, amount: childcareFixed.amount[0], category: childcareFixed.category, date });
    }

    // 나머지 랜덤 지출
    const nonFixedTemplates = EXPENSE_TEMPLATES.filter(t => t.category !== 'fixed' && t.merchant !== '어린이집');
    for (let i = 0; i < expensesThisMonth; i++) {
      const template = nonFixedTemplates[Math.floor(Math.random() * nonFixedTemplates.length)];
      const day = 1 + Math.floor(Math.random() * daysInMonth);
      const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const amount = template.amount[Math.floor(Math.random() * template.amount.length)];
      expenses.push({ merchant: template.merchant, amount, category: template.category, date });
    }

    // 다음 달로
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  return expenses;
}

export default function SeedPage() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      setUser(user);
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const runSeed = async () => {
    setIsRunning(true);
    setStatus('시작...');

    try {
      // 1. guest 키 존재 확인
      const exists = await validateHouseholdKey(GUEST_KEY);
      if (!exists) {
        setStatus('guest 가구 생성 중...');
        await createHousehold(GUEST_NAME, GUEST_KEY);
      } else {
        setStatus('guest 가구 이미 존재');
      }

      // 2. 기존 샘플 데이터 확인
      const expensesRef = collection(db, 'expenses');
      const q = query(expensesRef, where('householdId', '==', GUEST_KEY));
      const snapshot = await getDocs(q);

      if (snapshot.size > 0) {
        setStatus(`이미 ${snapshot.size}개의 샘플 데이터가 있습니다.`);
        setIsRunning(false);
        return;
      }

      // 3. 샘플 데이터 추가
      setStatus('샘플 데이터 생성 중...');
      const sampleExpenses = generateSampleExpenses();
      setStatus(`${sampleExpenses.length}개의 샘플 데이터 추가 중...`);

      let count = 0;
      for (const expense of sampleExpenses) {
        const hour = 9 + Math.floor(Math.random() * 12);
        const minute = Math.floor(Math.random() * 60);
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

        await addDoc(expensesRef, {
          merchant: expense.merchant,
          amount: expense.amount,
          category: expense.category,
          date: expense.date,
          time: timeStr,
          cardType: 'main',
          cardLastFour: '1234',
          memo: '',
          householdId: GUEST_KEY,
          createdAt: Timestamp.now(),
        });

        count++;
        if (count % 50 === 0) {
          setStatus(`${count}/${sampleExpenses.length}개 추가 중...`);
        }
      }

      setStatus(`완료! ${sampleExpenses.length}개의 샘플 데이터 추가됨 (2025.01 ~ 2026.01)`);
    } catch (error) {
      console.error(error);
      setStatus('에러: ' + (error as Error).message);
    } finally {
      setIsRunning(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-slate-400">로딩중...</div>
      </div>
    );
  }

  if (!user || !isAdmin(user)) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <div className="text-slate-400">접근 권한 없음</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-4">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-bold text-slate-800 mb-6">샘플 데이터 생성</h1>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
          <p className="text-sm text-slate-600 mb-4">
            게스트용 샘플 데이터를 생성합니다.<br />
            키: <code className="bg-slate-100 px-2 py-0.5 rounded">guest</code>
          </p>

          <button
            onClick={runSeed}
            disabled={isRunning}
            className="w-full py-3 bg-blue-500 text-white rounded-xl font-medium hover:bg-blue-600 disabled:bg-slate-300 transition-colors"
          >
            {isRunning ? '실행 중...' : '샘플 데이터 생성'}
          </button>

          {status && (
            <div className="mt-4 p-3 bg-slate-50 rounded-lg text-sm text-slate-700">
              {status}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

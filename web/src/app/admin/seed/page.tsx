'use client';

import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { collection, addDoc, Timestamp, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { createHousehold, validateHouseholdKey } from '@/lib/householdService';
import { onAuthChange, isAdmin } from '@/lib/authService';

const GUEST_KEY = 'guest';
const GUEST_NAME = '샘플 가계부';

// 샘플 데이터
const SAMPLE_EXPENSES = [
  { merchant: '스타벅스', amount: 6500, category: 'food', daysAgo: 0 },
  { merchant: '쿠팡', amount: 45000, category: 'living', daysAgo: 0 },
  { merchant: '이마트', amount: 87000, category: 'food', daysAgo: 1 },
  { merchant: '넷플릭스', amount: 17000, category: 'fixed', daysAgo: 2 },
  { merchant: '주유소', amount: 80000, category: 'living', daysAgo: 2 },
  { merchant: '어린이집', amount: 450000, category: 'childcare', daysAgo: 3 },
  { merchant: 'GS25', amount: 3500, category: 'food', daysAgo: 3 },
  { merchant: '다이소', amount: 12000, category: 'living', daysAgo: 4 },
  { merchant: '올리브영', amount: 35000, category: 'living', daysAgo: 5 },
  { merchant: '배달의민족', amount: 28000, category: 'food', daysAgo: 5 },
  { merchant: '병원', amount: 15000, category: 'etc', daysAgo: 6 },
  { merchant: '교보문고', amount: 22000, category: 'etc', daysAgo: 7 },
  { merchant: '맥도날드', amount: 15500, category: 'food', daysAgo: 8 },
  { merchant: '통신비', amount: 55000, category: 'fixed', daysAgo: 10 },
  { merchant: '관리비', amount: 180000, category: 'fixed', daysAgo: 10 },
  { merchant: '카페', amount: 4500, category: 'food', daysAgo: 12 },
  { merchant: '마트', amount: 65000, category: 'food', daysAgo: 14 },
  { merchant: '아기용품', amount: 78000, category: 'childcare', daysAgo: 15 },
  { merchant: '약국', amount: 8500, category: 'etc', daysAgo: 18 },
  { merchant: '주차비', amount: 5000, category: 'living', daysAgo: 20 },
];

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
      setStatus('샘플 데이터 추가 중...');
      const now = new Date();

      for (const expense of SAMPLE_EXPENSES) {
        const date = new Date(now);
        date.setDate(date.getDate() - expense.daysAgo);
        const dateStr = date.toISOString().split('T')[0];
        const hour = 9 + Math.floor(Math.random() * 12);
        const minute = Math.floor(Math.random() * 60);
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

        await addDoc(expensesRef, {
          merchant: expense.merchant,
          amount: expense.amount,
          category: expense.category,
          date: dateStr,
          time: timeStr,
          cardType: 'main',
          cardLastFour: '1234',
          memo: '',
          householdId: GUEST_KEY,
          createdAt: Timestamp.now(),
        });
      }

      setStatus(`완료! ${SAMPLE_EXPENSES.length}개의 샘플 데이터 추가됨`);
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

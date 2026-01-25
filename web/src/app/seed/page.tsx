'use client';

import { useState } from 'react';
import { collection, getDocs, deleteDoc, doc, addDoc, getFirestore } from 'firebase/firestore';
import { app } from '@/lib/firebase';

const db = getFirestore(app);

interface ExpenseData {
  date: string;
  time: string;
  merchant: string;
  amount: number;
  category: string;
  memo?: string;
  cardType: string;
  cardLastFour: string;
}

const realExpenses: ExpenseData[] = [
  // 01/01
  { date: '2026-01-01', time: '12:32', merchant: '라스튼커피', amount: 22000, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-01', time: '12:25', merchant: '라스튼커피', amount: 10000, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-01', time: '10:43', merchant: '(주)태산이앤엘 청계가스충전소', amount: 26571, category: 'living', cardType: 'KB', cardLastFour: '0027' },

  // 01/02
  { date: '2026-01-02', time: '16:46', merchant: '현선이네', amount: 9000, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-02', time: '13:33', merchant: 'CJ올리브네트웍스', amount: 15400, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-02', time: '10:30', merchant: '효성에프엠에스', amount: 11900, category: 'living', cardType: 'KB', cardLastFour: '0027' },

  // 01/03
  { date: '2026-01-03', time: '22:01', merchant: '오븐에빠진닭(공덕역점)', amount: 198500, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-03', time: '19:22', merchant: '마포양지설렁탕', amount: 198000, category: 'food', cardType: 'KB', cardLastFour: '0027' },

  // 01/04
  { date: '2026-01-04', time: '14:37', merchant: '아이사랑약국', amount: 3300, category: 'emergency', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-04', time: '14:36', merchant: '센트럴아동병원', amount: 11000, category: 'emergency', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-04', time: '11:49', merchant: '컴포즈커피', amount: 3900, category: 'food', cardType: 'KB', cardLastFour: '0027' },

  // 01/05
  { date: '2026-01-05', time: '22:47', merchant: '쿠팡(주)', amount: 15990, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-05', time: '22:32', merchant: '쿠팡', amount: 32290, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-05', time: '20:37', merchant: '쿠팡(주)', amount: 22180, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-05', time: '18:19', merchant: '지에스더프레시 동탄아이비파크점', amount: 1280, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-05', time: '14:38', merchant: '쿠팡', amount: 7600, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-05', time: '12:57', merchant: '메가MGC', amount: 2600, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-05', time: '12:00', merchant: '카림파크 정육점', amount: 11600, category: 'food', cardType: '지역화폐', cardLastFour: '' },

  // 01/06
  { date: '2026-01-06', time: '18:07', merchant: '쿠팡이츠', amount: 25700, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-06', time: '12:39', merchant: '메가MGC', amount: 2600, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-06', time: '11:19', merchant: '(주)이마트 동탄점', amount: 12800, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-06', time: '11:04', merchant: '(주)이마트 동탄점', amount: 32400, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-06', time: '10:29', merchant: '위대한탄생 여성의원', amount: 9300, category: 'emergency', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-06', time: '10:00', merchant: '컴포즈커피 동탄카림2차점', amount: 8400, category: 'food', cardType: '지역화폐', cardLastFour: '' },

  // 01/07
  { date: '2026-01-07', time: '12:00', merchant: '동경빵집', amount: 5800, category: 'food', cardType: '지역화폐', cardLastFour: '' },
  { date: '2026-01-07', time: '11:00', merchant: '그라츠커피랩 동탄여울공원점', amount: 10620, category: 'food', cardType: '지역화폐', cardLastFour: '' },

  // 01/08
  { date: '2026-01-08', time: '09:46', merchant: '여권발급수수료', amount: 30000, category: 'etc', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-08', time: '12:00', merchant: '정떡집', amount: 10000, category: 'food', cardType: '지역화폐', cardLastFour: '' },
  { date: '2026-01-08', time: '11:00', merchant: '동경빵집', amount: 4300, category: 'food', cardType: '지역화폐', cardLastFour: '' },

  // 01/09
  { date: '2026-01-09', time: '19:45', merchant: '쿠팡이츠', amount: 46000, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-09', time: '17:36', merchant: '지에스더프레시 동탄아이비파크점', amount: 3990, category: 'food', cardType: 'KB', cardLastFour: '0027' },

  // 01/10
  { date: '2026-01-10', time: '21:07', merchant: '컬리', amount: 47120, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-10', time: '20:45', merchant: 'GS25 동탄아이비', amount: 17300, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-10', time: '10:17', merchant: '지에스더프레시 동탄아이비파크점', amount: 13610, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-10', time: '12:00', merchant: '고반식당 동탄역점', amount: 74000, category: 'food', cardType: '지역화폐', cardLastFour: '' },
  { date: '2026-01-10', time: '11:00', merchant: '다스브로트', amount: 21493, category: 'food', cardType: '지역화폐', cardLastFour: '' },

  // 01/11
  { date: '2026-01-11', time: '17:21', merchant: '신세계 사우스시티', amount: 10000, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-11', time: '08:23', merchant: '모바일이즐', amount: 300, category: 'etc', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-11', time: '13:00', merchant: '마실통닭 동탄여울공원지점', amount: 21900, category: 'food', cardType: '지역화폐', cardLastFour: '' },
  { date: '2026-01-11', time: '12:00', merchant: '조선평양냉면', amount: 23000, category: 'food', cardType: '지역화폐', cardLastFour: '' },

  // 01/12
  { date: '2026-01-12', time: '17:27', merchant: '지에스더프레시 동탄아이비파크점', amount: 6180, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-12', time: '17:00', merchant: '삼성웰스토리 DS에듀센터', amount: 1600, category: 'childcare', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-12', time: '13:28', merchant: '우지커피 동탄타임스퀘어점', amount: 6300, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-12', time: '11:58', merchant: '의료법인상운의료재단', amount: 162290, category: 'emergency', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-12', time: '14:00', merchant: '카림파크 정육점', amount: 9580, category: 'food', cardType: '지역화폐', cardLastFour: '' },
  { date: '2026-01-12', time: '13:00', merchant: '네코텐', amount: 21500, category: 'food', cardType: '지역화폐', cardLastFour: '' },

  // 01/13
  { date: '2026-01-13', time: '15:33', merchant: '쿠팡', amount: 30470, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-13', time: '14:00', merchant: '도도약국', amount: 48000, category: 'emergency', cardType: '지역화폐', cardLastFour: '' },
  { date: '2026-01-13', time: '13:00', merchant: '(주)더여울', amount: 1440, category: 'food', cardType: '지역화폐', cardLastFour: '' },

  // 01/14
  { date: '2026-01-14', time: '17:02', merchant: '(주)이마트 동탄점', amount: 41560, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-14', time: '15:20', merchant: '네이버페이', amount: 10934, category: 'childcare', memo: '기저귀', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-14', time: '14:32', merchant: '(주)일리에콩브레', amount: 4900, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-14', time: '14:31', merchant: '(주)일리에콩브레', amount: 13100, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-14', time: '14:12', merchant: '자동결제용', amount: 6050, category: 'allowance', memo: '웹하드', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-14', time: '12:00', merchant: '꾸메뜨락직화쭈꾸미', amount: 47000, category: 'food', cardType: '지역화폐', cardLastFour: '' },

  // 01/15
  { date: '2026-01-15', time: '12:18', merchant: '쿠팡이츠', amount: 11000, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-15', time: '12:08', merchant: '(주)스타필드수원', amount: 74600, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-15', time: '12:01', merchant: '구글플레이', amount: 29000, category: 'fixed', memo: 'gemini', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-15', time: '11:44', merchant: '(주)스타필드수원', amount: 13400, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-15', time: '11:22', merchant: '평동LPG충전소', amount: 49042, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-15', time: '07:10', merchant: 'LGUPLUS 통신요금', amount: 40840, category: 'fixed', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-15', time: '13:00', merchant: '뷔르아워', amount: 15400, category: 'food', cardType: '지역화폐', cardLastFour: '' },

  // 01/16
  { date: '2026-01-16', time: '17:53', merchant: '박하약국', amount: 2800, category: 'emergency', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-16', time: '16:26', merchant: '반디소아청소년과', amount: 4900, category: 'emergency', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-16', time: '12:28', merchant: 'M베이커리까페', amount: 10200, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-16', time: '14:00', merchant: '유복해물칼국수동탄직영점', amount: 43000, category: 'food', cardType: '지역화폐', cardLastFour: '' },
  { date: '2026-01-16', time: '13:00', merchant: '동탄올바른안과의원', amount: 15400, category: 'emergency', cardType: '지역화폐', cardLastFour: '' },
  { date: '2026-01-16', time: '12:00', merchant: '도도약국', amount: 1600, category: 'emergency', cardType: '지역화폐', cardLastFour: '' },

  // 01/17
  { date: '2026-01-17', time: '09:18', merchant: '배민클럽', amount: 1990, category: 'fixed', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-17', time: '13:00', merchant: '맘스터치 동탄여울공원점', amount: 7900, category: 'food', cardType: '지역화폐', cardLastFour: '' },
  { date: '2026-01-17', time: '12:00', merchant: '컴포즈커피 동탄카림2차점', amount: 2800, category: 'food', cardType: '지역화폐', cardLastFour: '' },

  // 01/18
  { date: '2026-01-18', time: '23:57', merchant: '쿠팡(주)', amount: 107350, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-18', time: '12:55', merchant: '롯데쇼핑 동탄점 아페쎄카페', amount: 12500, category: 'food', cardType: 'KB', cardLastFour: '0027' },

  // 01/19
  { date: '2026-01-19', time: '20:42', merchant: '쿠팡이츠', amount: 33500, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-19', time: '12:18', merchant: '메가MGC', amount: 2600, category: 'food', cardType: 'KB', cardLastFour: '0027' },

  // 01/20
  { date: '2026-01-20', time: '23:55', merchant: 'KCP(결제대행)', amount: 228000, category: 'travel', memo: '라페스타 힐튼', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-20', time: '23:24', merchant: 'KCP(결제대행)', amount: 652000, category: 'travel', memo: '라페스타 힐튼', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-20', time: '18:56', merchant: '쿠팡이츠', amount: 23500, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-20', time: '13:53', merchant: '롯데쇼핑 동탄점 해욱담', amount: 20000, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-20', time: '13:14', merchant: '롯데쇼핑 동탄점 아메리칸트레', amount: 7490, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-20', time: '10:17', merchant: '마이더스산부인과의원', amount: 9300, category: 'emergency', cardType: 'KB', cardLastFour: '0027' },

  // 01/21
  { date: '2026-01-21', time: '21:15', merchant: '쿠팡이츠', amount: 22700, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-21', time: '21:01', merchant: '쿠팡이츠', amount: 19400, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-21', time: '12:20', merchant: '메가엠지씨커피 삼성전자DSR타워점', amount: 6700, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-21', time: '10:48', merchant: '쿠팡(주)', amount: 11850, category: 'living', cardType: 'KB', cardLastFour: '0027' },

  // 01/22
  { date: '2026-01-22', time: '20:49', merchant: '동백연화 동탄여울공원점', amount: 23000, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-22', time: '20:46', merchant: '마실통닭 동탄여울공원지점', amount: 8900, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-22', time: '16:57', merchant: '(주)이마트 동탄점', amount: 31260, category: 'living', cardType: 'KB', cardLastFour: '0027' },

  // 01/23
  { date: '2026-01-23', time: '16:43', merchant: '지에스더프레시 동탄아이비파크점', amount: 3680, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-23', time: '16:23', merchant: '반디소아청소년과', amount: 2900, category: 'emergency', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-23', time: '13:05', merchant: '라그로서리', amount: 51000, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-23', time: '14:00', merchant: '카림파크 정육점', amount: 9800, category: 'food', cardType: '지역화폐', cardLastFour: '' },
  { date: '2026-01-23', time: '13:00', merchant: '도도약국', amount: 2300, category: 'emergency', cardType: '지역화폐', cardLastFour: '' },

  // 01/24
  { date: '2026-01-24', time: '23:30', merchant: 'GS25 동탄아이비', amount: 16600, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-24', time: '22:01', merchant: '쿠팡이츠', amount: 17900, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-24', time: '21:08', merchant: '쿠팡이츠', amount: 19500, category: 'food', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-24', time: '15:00', merchant: '동탄챔피언락볼링센터', amount: 43500, category: 'allowance', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-24', time: '13:38', merchant: '포레스트', amount: 40500, category: 'allowance', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-24', time: '10:59', merchant: '(주)태산이앤엘 청계가스충전소', amount: 33934, category: 'living', cardType: 'KB', cardLastFour: '0027' },
  { date: '2026-01-24', time: '14:00', merchant: 'GS25 동탄아이비점', amount: 12000, category: 'food', cardType: '지역화폐', cardLastFour: '' },
  { date: '2026-01-24', time: '13:00', merchant: 'GS25 동탄아이비점', amount: 13700, category: 'food', cardType: '지역화폐', cardLastFour: '' },

  // 01/25
  { date: '2026-01-25', time: '11:18', merchant: '메가엠지씨커피 동탄반도카림2차점', amount: 6800, category: 'food', cardType: 'KB', cardLastFour: '0027' },
];

export default function SeedPage() {
  const [status, setStatus] = useState<string>('');
  const [isRunning, setIsRunning] = useState(false);

  const deleteAllExpenses = async () => {
    setStatus('기존 데이터 삭제 중...');
    const expensesRef = collection(db, 'expenses');
    const snapshot = await getDocs(expensesRef);

    let deleted = 0;
    for (const docSnap of snapshot.docs) {
      await deleteDoc(doc(db, 'expenses', docSnap.id));
      deleted++;
      setStatus(`삭제 중... ${deleted}/${snapshot.docs.length}`);
    }

    return snapshot.docs.length;
  };

  const addExpenses = async () => {
    const expensesRef = collection(db, 'expenses');

    let added = 0;
    for (const expense of realExpenses) {
      await addDoc(expensesRef, {
        ...expense,
        createdAt: new Date().toISOString(),
      });
      added++;
      setStatus(`추가 중... ${added}/${realExpenses.length}`);
    }

    return realExpenses.length;
  };

  const runSeed = async () => {
    setIsRunning(true);
    try {
      const deletedCount = await deleteAllExpenses();
      setStatus(`${deletedCount}개 삭제 완료. 새 데이터 추가 중...`);

      const addedCount = await addExpenses();
      setStatus(`완료! ${deletedCount}개 삭제, ${addedCount}개 추가됨`);
    } catch (error) {
      setStatus(`에러: ${error}`);
    }
    setIsRunning(false);
  };

  const totalAmount = realExpenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="min-h-screen p-8 bg-slate-100">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">데이터 시드</h1>

        <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
          <h2 className="text-lg font-semibold mb-4">1월 실제 지출 데이터</h2>
          <p className="text-slate-600 mb-2">총 {realExpenses.length}건</p>
          <p className="text-slate-600 mb-4">총액: {totalAmount.toLocaleString()}원</p>

          <button
            onClick={runSeed}
            disabled={isRunning}
            className={`w-full py-3 rounded-lg text-white font-medium ${
              isRunning
                ? 'bg-slate-400 cursor-not-allowed'
                : 'bg-blue-500 hover:bg-blue-600'
            }`}
          >
            {isRunning ? '실행 중...' : '기존 데이터 삭제 후 실제 데이터 추가'}
          </button>

          {status && (
            <div className="mt-4 p-4 bg-slate-100 rounded-lg text-slate-700">
              {status}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl p-6 shadow-sm">
          <h2 className="text-lg font-semibold mb-4">데이터 미리보기</h2>
          <div className="max-h-96 overflow-y-auto text-sm">
            {realExpenses.slice(0, 20).map((e, i) => (
              <div key={i} className="flex justify-between py-2 border-b border-slate-100">
                <div>
                  <span className="text-slate-500">{e.date}</span>
                  <span className="ml-2">{e.merchant}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs px-2 py-0.5 bg-slate-100 rounded">{e.category}</span>
                  <span className="font-medium">{e.amount.toLocaleString()}원</span>
                </div>
              </div>
            ))}
            {realExpenses.length > 20 && (
              <div className="text-center py-4 text-slate-500">
                ... 외 {realExpenses.length - 20}건
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

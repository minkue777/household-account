import { NextRequest, NextResponse } from 'next/server';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export async function POST(request: NextRequest) {
  try {
    const { householdId, year, month, amount } = await request.json();

    if (!householdId || !year || !month || amount === undefined) {
      return NextResponse.json(
        { error: 'householdId, year, month, amount 필요' },
        { status: 400 }
      );
    }

    const docId = `${householdId}_${year}`;
    const docRef = doc(db, 'dividend_snapshots', docId);

    // 기존 데이터 가져오거나 새로 생성
    const { getDoc } = await import('firebase/firestore');
    const existing = await getDoc(docRef);

    let monthlyData = Array(12).fill(0);
    if (existing.exists()) {
      monthlyData = existing.data().monthlyData || Array(12).fill(0);
    }

    // 해당 월 업데이트 (month는 1-12)
    monthlyData[month - 1] = amount;

    await setDoc(docRef, {
      householdId,
      year,
      monthlyData,
      updatedAt: Timestamp.now(),
    });

    return NextResponse.json({
      success: true,
      message: `${year}년 ${month}월 배당금 ${amount.toLocaleString()}원 저장 완료`,
      monthlyData
    });
  } catch (error) {
    console.error('배당금 저장 오류:', error);
    return NextResponse.json(
      { error: '저장 실패' },
      { status: 500 }
    );
  }
}

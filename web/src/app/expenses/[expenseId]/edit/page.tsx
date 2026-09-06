import { redirect } from 'next/navigation';

/** 구조화된 알림 경로를 기존 원장 수정 UI에 연결합니다. */
export default function ExpenseNotificationEditPage({ params }: { params: { expenseId: string } }) {
  redirect(`/?edit=${encodeURIComponent(params.expenseId)}`);
}

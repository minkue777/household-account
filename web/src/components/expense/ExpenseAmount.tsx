import type { Expense } from '@/types/expense';

export default function ExpenseAmount({ expense }: { expense: Pick<Expense, 'amount' | 'foreignPayment'> }) {
  const foreign = expense.foreignPayment;
  const won = `${expense.amount.toLocaleString('ko-KR')}원`;
  return (
    <span className="inline-flex flex-col items-end text-right tabular-nums">
      <span className="font-semibold text-slate-800">{foreign ? `${foreign.amount.toLocaleString('ko-KR')}엔` : won}</span>
      {foreign && <span className="text-xs font-normal text-slate-500">
        {expense.amount === Math.round(foreign.amount * foreign.rateInWon) ? '약 ' : '반영 '}{won}
      </span>}
    </span>
  );
}

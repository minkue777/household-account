import { render, screen, fireEvent } from '@testing-library/react';
import ExpenseAmount from '@/components/expense/ExpenseAmount';
import CategoryExpenseModal from '@/components/stats/CategoryExpenseModal';
import { mapExpenseReadData, mapCommandTransaction } from '@/features/ledger/application/ledgerExpenseMapping';
import type { LedgerTransactionCommandResult } from '@/platform/functions-api/householdCommandContract';

jest.mock('@/contexts/CategoryContext',()=>({ useCategoryContext:()=>({getCategoryLabel:()=> '의류',getCategoryColor:()=> '#a855f7'}) }));
const foreignPayment={currency:'JPY' as const,amount:16_248,rateInWon:8.5,rateDate:'2026-10-30',provider:'frankfurter-ecb' as const};
const expense=mapExpenseReadData('japan-1',{date:'2026-10-30',merchant:'폴로',amountInWon:138_108,categoryId:'clothes',foreignPayment});

it('엔은 숫자 뒤에 표시하고 원화 환산액을 보조로 표시한다',()=>{
  render(<ExpenseAmount expense={expense}/>);
  expect(screen.getByText('16,248엔')).toBeInTheDocument();
  expect(screen.getByText('약 138,108원')).toBeInTheDocument();
  expect(screen.queryByText(/¥/)).not.toBeInTheDocument();
});
it('원화 지출은 기존 표시를 유지한다',()=>{
  render(<ExpenseAmount expense={{amount:12000}}/>);
  expect(screen.getByText('12,000원')).toBeInTheDocument();
  expect(screen.queryByText(/약/)).not.toBeInTheDocument();
});
it('원화 반영액을 직접 조정해도 엔화 증거를 바꾸거나 고시 환산액이라고 표시하지 않는다',()=>{
  render(<ExpenseAmount expense={{...expense,amount:140000}}/>);
  expect(screen.getByText('16,248엔')).toBeInTheDocument();
  expect(screen.getByText('반영 140,000원')).toBeInTheDocument();
});
it('카테고리·월 합계에는 엔화 숫자가 아니라 원화 환산액을 더한다',()=>{
  render(<CategoryExpenseModal category="clothes" expenses={[expense,{...expense,id:'won',foreignPayment:undefined,amount:10000}]} onClose={jest.fn()} onExpenseClick={jest.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:/2026년 10월/}));
  expect(screen.getByText('2건 · 148,108원')).toBeInTheDocument();
  expect(screen.getByText('16,248엔')).toBeInTheDocument();
  expect(screen.getByText('10,000원')).toBeInTheDocument();
});
it('일반 수정 응답 후 외화 증거를 유지하고 원화 파생 거래에서는 상속하지 않는다',()=>{
  const response={transactionId:'japan-1',aggregateVersion:2,accountingDate:expense.date,merchant:'변경',amountInWon:expense.amount,transactionType:'expense',categoryId:'clothes',memo:'',cardType:'captured',cardDisplay:'토스',foreignPayment} as LedgerTransactionCommandResult;
  expect(mapCommandTransaction(response,expense).foreignPayment).toEqual(foreignPayment);
  expect(mapCommandTransaction({...response,foreignPayment:undefined},expense).foreignPayment).toBeUndefined();
});

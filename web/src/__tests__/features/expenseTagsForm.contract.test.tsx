import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useState } from 'react';
import type { Expense } from '@/types/expense';
import AddExpenseModal from '@/components/expense/AddExpenseModal';
import ExpenseEditModal from '@/components/expense/ExpenseEditModal';
import ExpenseTagInput from '@/components/expense/ExpenseTagInput';
import { MAX_EXPENSE_TAG_LENGTH, MAX_EXPENSE_TAGS } from '@/lib/utils/expenseTags';

const mockActiveCategories = [
  { key: 'food', label: '식비', color: '#ef4444', isDefault: true },
];

jest.mock('@/contexts/CategoryContext', () => ({
  useCategoryContext: () => ({
    activeCategories: mockActiveCategories,
    isLoading: false,
    getCategoryLabel: (category: string) => category,
  }),
}));

jest.mock('@/contexts/AppDialogContext', () => ({
  useAppDialog: () => ({ showAlert: jest.fn().mockResolvedValue(undefined) }),
}));

const expense: Expense = {
  id: 'tagged-expense',
  aggregateVersion: 1,
  date: '2026-09-18',
  merchant: '부산 식당',
  amount: 12_000,
  category: 'food',
  transactionType: 'expense',
};

function TagInputHarness({ initialTags = [] }: { initialTags?: string[] }) {
  const [tags, setTags] = useState<string[]>(initialTags);
  const [input, setInput] = useState('');
  return <ExpenseTagInput tags={tags} onChange={setTags} inputValue={input} onInputChange={setInput} availableTags={['2026부산여행', '가족모임']} />;
}

describe('[T-LED-011][LED-011] 지출 태그 입력과 저장', () => {
  test('기존 태그를 재사용하고 중복 없이 직접 추가하며 한글 조합 Enter는 기다린다', () => {
    render(<TagInputHarness />);
    fireEvent.click(screen.getByRole('button', { name: '#2026부산여행' }));
    expect(screen.getByRole('button', { name: '2026부산여행 태그 제거' })).toBeInTheDocument();

    const input = screen.getByRole('textbox', { name: '태그 (선택)' });
    expect(input).toHaveAttribute('maxlength', String(MAX_EXPENSE_TAG_LENGTH));
    expect(screen.queryByRole('button', { name: '#2026부산여행' })).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: '#2026부산여행' } });
    fireEvent.click(screen.getByRole('button', { name: '태그 추가' }));
    expect(screen.getAllByRole('button', { name: '2026부산여행 태그 제거' })).toHaveLength(1);
    expect(input).toHaveValue('');

    fireEvent.change(input, { target: { value: '기념일' } });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: true });
    expect(screen.queryByRole('button', { name: '기념일 태그 제거' })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
    expect(screen.getByRole('button', { name: '기념일 태그 제거' })).toBeInTheDocument();
  });

  test('입력한 이름으로 기존 태그를 좁히고 선택하면 입력칸을 비운다', () => {
    render(<TagInputHarness />);
    const input = screen.getByRole('textbox', { name: '태그 (선택)' });
    fireEvent.change(input, { target: { value: '#부산' } });
    expect(screen.queryByRole('button', { name: '#가족모임' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '#2026부산여행' }));
    expect(input).toHaveValue('');
    expect(screen.getByRole('button', { name: '2026부산여행 태그 제거' })).toBeInTheDocument();
  });

  test('태그 한도에 도달하면 추가를 막고 기존 태그를 제거하면 다시 입력할 수 있다', () => {
    render(<TagInputHarness initialTags={Array.from({ length: MAX_EXPENSE_TAGS - 1 }, (_, index) => `행사${index}`)} />);
    const input = screen.getByRole('textbox', { name: '태그 (선택)' });
    fireEvent.change(input, { target: { value: '마지막행사' } });
    fireEvent.click(screen.getByRole('button', { name: '태그 추가' }));
    expect(input).toBeDisabled();
    expect(screen.getByRole('button', { name: '태그 추가' })).toBeDisabled();
    expect(input).toHaveAccessibleDescription(`태그는 최대 ${MAX_EXPENSE_TAGS}개까지 추가할 수 있어요.`);
    fireEvent.click(screen.getByRole('button', { name: '마지막행사 태그 제거' }));
    expect(input).toBeEnabled();
    expect(screen.getByRole('button', { name: '#2026부산여행' })).toBeInTheDocument();
  });

  test('태그만 바꾸어도 저장하고 입력 중인 태그를 함께 반영한다', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<ExpenseEditModal expense={expense} isOpen onClose={jest.fn()} onSave={onSave} transactionType="expense" availableTags={['2026부산여행']} />);
    fireEvent.click(screen.getByRole('button', { name: '#2026부산여행' }));
    fireEvent.change(screen.getByRole('textbox', { name: '태그 (선택)' }), { target: { value: '가족모임' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ tags: ['2026부산여행', '가족모임'] }, false));
  });

  test('마지막 태그 제거는 빈 배열로 저장한다', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<ExpenseEditModal expense={{ ...expense, tags: ['2026부산여행'] }} isOpen onClose={jest.fn()} onSave={onSave} transactionType="expense" />);
    fireEvent.click(screen.getByRole('button', { name: '2026부산여행 태그 제거' }));
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ tags: [] }, false));
  });

  test('지출 추가는 추천 태그와 입력 중 태그를 일곱 번째 인자로 전달한다', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<AddExpenseModal isOpen onClose={jest.fn()} onAdd={onAdd} selectedDate="2026-09-18" transactionType="expense" availableTags={['2026부산여행']} />);
    fireEvent.change(screen.getByPlaceholderText('가맹점명을 입력하세요'), { target: { value: '부산 식당' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('button', { name: '#2026부산여행' }));
    fireEvent.change(screen.getByRole('textbox', { name: '태그 (선택)' }), { target: { value: '가족모임' } });
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('부산 식당', 12_000, 'food', '2026-09-18', undefined, undefined, ['2026부산여행', '가족모임']));
  });

  test('수입에는 태그 입력을 표시하거나 전송하지 않는다', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    render(<AddExpenseModal isOpen onClose={jest.fn()} onAdd={onAdd} selectedDate="2026-09-18" transactionType="income" availableTags={['2026부산여행']} />);
    expect(screen.queryByRole('textbox', { name: '태그 (선택)' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('항목을 입력하세요'), { target: { value: '용돈' } });
    fireEvent.change(screen.getByPlaceholderText('0'), { target: { value: '12000' } });
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('수입', 12_000, 'etc', '2026-09-18', '용돈'));
  });

  test('수입 수정은 원본에 태그가 있어도 태그를 변경하지 않는다', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<ExpenseEditModal expense={{ ...expense, transactionType: 'income', memo: '용돈', tags: ['2026부산여행'] }} isOpen onClose={jest.fn()} onSave={onSave} transactionType="income" />);
    expect(screen.queryByRole('textbox', { name: '태그 (선택)' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('항목을 입력하세요'), { target: { value: '급여' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ memo: '급여' }, false));
  });
});

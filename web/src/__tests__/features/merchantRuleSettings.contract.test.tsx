import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import type { MerchantRule } from '@/types/merchant';
const mockUpdate = jest.fn();
const mockAdd = jest.fn();
const mockDelete = jest.fn();
const mockRules: MerchantRule[] = [
  { id: 'a', householdId: 'house', merchantKeyword: 'A', matchType: 'contains', priority: 30, mapping: { merchant: '치환 이름', memo: '치환 메모', category: 'food' }, version: 1 },
  { id: 'b', householdId: 'house', merchantKeyword: 'B', matchType: 'contains', priority: 20, mapping: {} },
  { id: 'inactive', householdId: 'house', merchantKeyword: 'C', matchType: 'contains', priority: 10, mapping: {}, isActive: false },
];
jest.mock('@/lib/merchantRuleService', () => ({
  subscribeToRules: (_household: string, callback: (rules: MerchantRule[]) => void) => { callback(mockRules); return jest.fn(); },
  updateMerchantRuleV2: (...args: unknown[]) => mockUpdate(...args),
  addMerchantRuleV2: (...args: unknown[]) => mockAdd(...args),
  deleteMerchantRule: (...args: unknown[]) => mockDelete(...args),
  MATCH_TYPE_LABELS: { contains: '포함' },
}));
jest.mock('@/contexts/HouseholdContext', () => ({ useHousehold: () => ({ householdKey: 'house' }) }));
jest.mock('@/contexts/CategoryContext', () => ({ useCategoryContext: () => ({ activeCategories: [{ key: 'food', label: '식비', color: '#000000' }], getCategoryLabel: (id: string) => id, getCategoryColor: () => '#000000' }) }));
import MerchantRuleSettings from '@/components/settings/MerchantRuleSettings';

describe('[MER-003][MER-004] 가맹점 규칙 설정', () => {
  beforeEach(() => {
    mockAdd.mockReset();
    mockDelete.mockReset();
    mockUpdate.mockReset().mockResolvedValue(undefined);
    HTMLElement.prototype.scrollIntoView = jest.fn();
  });
  test('[MER-003] 기존 가맹점·메모 치환을 지우면 명시적인 빈 값으로 제출한다', async () => {
    render(<MerchantRuleSettings />);
    fireEvent.click(screen.getByRole('button', { name: /가맹점 규칙/ }));
    fireEvent.click(screen.getByRole('button', { name: 'A 규칙 수정' }));
    fireEvent.change(screen.getByPlaceholderText('비워두면 원본 가맹점명 유지'), { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText('자동으로 추가될 메모'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith('a', {
      merchantKeyword: 'A', matchType: 'contains', mapping: { merchant: '', memo: '', category: 'food' },
    }, 1));
  });
  test('목록에는 수정·삭제만 제공하고 순서 변경 동작은 제공하지 않는다', () => {
    render(<MerchantRuleSettings />);
    fireEvent.click(screen.getByRole('button', { name: /가맹점 규칙/ }));
    expect(screen.queryByRole('button', { name: /우선순위|순서 변경/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /규칙 수정$/ })).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: /규칙 삭제$/ })).toHaveLength(3);
  });
  test('중복 생성과 전송 실패 후에도 같은 초안으로 재시도한다', async () => {
    mockAdd.mockResolvedValueOnce('').mockRejectedValueOnce(new Error('연결 실패')).mockResolvedValueOnce('created');
    render(<MerchantRuleSettings />);
    fireEvent.click(screen.getByRole('button', { name: /가맹점 규칙/ }));
    fireEvent.click(screen.getByRole('button', { name: '새 규칙 추가' }));
    fireEvent.change(screen.getByPlaceholderText('예: 스타벅스, 효성에프엠에스'), { target: { value: '커피' } });
    fireEvent.click(screen.getByRole('button', { name: '식비' }));
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('이미 등록된 규칙입니다.');
    expect(screen.getByDisplayValue('커피')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('연결 실패'));
    expect(screen.getByDisplayValue('커피')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '추가' }));
    await waitFor(() => expect(screen.queryByDisplayValue('커피')).not.toBeInTheDocument());
    expect(mockAdd).toHaveBeenCalledTimes(3);
  });

  test('삭제 실패는 확인창에 남고 재시도도 처음 선택한 version을 사용한다', async () => {
    mockDelete.mockRejectedValueOnce(new Error('VERSION_MISMATCH')).mockResolvedValueOnce(undefined);
    render(<MerchantRuleSettings />);
    fireEvent.click(screen.getByRole('button', { name: /가맹점 규칙/ }));
    fireEvent.click(screen.getByRole('button', { name: 'A 규칙 삭제' }));
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('VERSION_MISMATCH');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '삭제' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockDelete.mock.calls).toEqual([['a', 1], ['a', 1]]);
  });

});

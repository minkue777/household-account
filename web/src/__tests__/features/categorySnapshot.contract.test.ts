import {
  readCategorySnapshot,
  writeCategorySnapshot,
} from '@/features/category-budget/application/categorySnapshot';

const category = {
  id: 'category-1',
  key: 'living',
  label: '생활',
  color: '#4ADE80',
  budget: 500_000,
  order: 0,
  isDefault: true,
  isActive: true,
  householdId: 'household-1',
};

describe('category snapshot contract', () => {
  beforeEach(() => window.localStorage.clear());

  it('같은 가구의 마지막 카테고리를 첫 paint 힌트로 복원한다', () => {
    writeCategorySnapshot('household-1', [category]);

    expect(readCategorySnapshot('household-1')).toEqual([category]);
  });

  it('다른 가구 또는 손상된 문서를 반환하지 않는다', () => {
    writeCategorySnapshot('household-1', [category]);
    expect(readCategorySnapshot('household-2')).toBeUndefined();

    window.localStorage.setItem(
      'household-account.categories.v1:household-1',
      JSON.stringify({
        version: 1,
        householdId: 'household-1',
        items: [{ ...category, householdId: 'household-other' }],
      })
    );
    expect(readCategorySnapshot('household-1')).toBeUndefined();
  });
});

import cases from '../../../../contracts/fixtures/system/category-compatibility.v1.json';
import { normalizeStoredCategoryId } from '@/lib/categoryCompatibility';

test.each(cases.cases)('stored category $storedValue preserves its canonical identity', ({ storedValue, categoryId }) => {
  expect(normalizeStoredCategoryId(storedValue)).toBe(categoryId);
});

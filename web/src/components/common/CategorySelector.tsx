'use client';

import { useCategoryContext } from '@/contexts/CategoryContext';

interface CategorySelectorProps {
  value: string;
  onChange: (category: string) => void;
  size?: 'sm' | 'md';
  isLoading?: boolean;
}

/**
 * 카테고리 선택 UI 컴포넌트
 * size='sm': 분할 모달 등 좁은 공간용 (가로 나열)
 * size='md': 기본 편집 모달용 (그리드)
 */
export default function CategorySelector({
  value,
  onChange,
  size = 'md',
  isLoading,
}: CategorySelectorProps) {
  const { activeCategories, isLoading: categoriesLoading } = useCategoryContext();

  const loading = isLoading ?? categoriesLoading;

  if (loading) {
    return (
      <div className={size === 'md' ? 'grid grid-cols-5 gap-2' : 'flex flex-wrap gap-2'}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={size === 'md' ? 'h-16 bg-slate-100 rounded-lg animate-pulse' : 'h-8 w-16 bg-slate-100 rounded-lg animate-pulse'}
          />
        ))}
      </div>
    );
  }

  if (size === 'sm') {
    return (
      <div className="flex flex-wrap gap-2">
        {activeCategories.map((cat) => (
          <button
            key={cat.key}
            type="button"
            onClick={() => onChange(cat.key)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border transition-colors text-xs ${
              value === cat.key
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: cat.color }}
            />
            <span className="text-slate-700">{cat.label}</span>
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {activeCategories.map((cat) => (
        <button
          key={cat.key}
          type="button"
          onClick={() => onChange(cat.key)}
          className={`flex flex-col items-center p-2 rounded-lg border-2 transition-colors min-w-[56px] ${
            value === cat.key
              ? 'border-blue-500 bg-blue-50'
              : 'border-slate-200 hover:border-slate-300'
          }`}
        >
          <div
            className="w-6 h-6 rounded-full mb-1"
            style={{ backgroundColor: cat.color }}
          />
          <span className="text-xs text-slate-700">
            {cat.label.slice(0, 2)}
          </span>
        </button>
      ))}
    </div>
  );
}

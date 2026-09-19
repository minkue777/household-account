'use client';

import { useId } from 'react';
import { Plus, X } from 'lucide-react';
import {
  MAX_EXPENSE_TAG_LENGTH,
  MAX_EXPENSE_TAGS,
  normalizeExpenseTags,
} from '@/lib/utils/expenseTags';

interface ExpenseTagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  inputValue: string;
  onInputChange: (value: string) => void;
  availableTags?: string[];
}

export default function ExpenseTagInput({
  tags,
  onChange,
  inputValue,
  onInputChange,
  availableTags = [],
}: ExpenseTagInputProps) {
  const inputId = useId();
  const descriptionId = `${inputId}-description`;
  const normalizedInput = normalizeExpenseTags([inputValue])[0] || '';
  const hasReachedLimit = tags.length >= MAX_EXPENSE_TAGS;
  const suggestions = Array.from(new Set(
    availableTags.flatMap((tag) => normalizeExpenseTags([tag]))
  ))
    .filter((tag) => !tags.includes(tag) && tag.toLocaleLowerCase().includes(normalizedInput.toLocaleLowerCase()))
    .slice(0, 5);

  const addTag = (tag: string) => {
    if (hasReachedLimit) return;
    onChange(normalizeExpenseTags([...tags, tag]));
    onInputChange('');
  };

  return (
    <div className="min-w-0">
      <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-slate-700">
        태그
      </label>

      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1" aria-label="선택한 태그">
          {tags.map((tag) => (
            <span key={tag} className="inline-flex max-w-full items-center gap-0.5 text-sm leading-5 text-blue-600">
              <span className="min-w-0 break-all">#{tag}</span>
              <button
                type="button"
                onClick={() => onChange(tags.filter((selectedTag) => selectedTag !== tag))}
                aria-label={`${tag} 태그 제거`}
                className="shrink-0 p-1 text-slate-400 transition-colors hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex min-w-0 gap-2">
        <input
          id={inputId}
          type="text"
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault();
              if (normalizedInput) addTag(normalizedInput);
            }
          }}
          maxLength={MAX_EXPENSE_TAG_LENGTH}
          disabled={hasReachedLimit}
          aria-describedby={hasReachedLimit ? descriptionId : undefined}
          autoComplete="off"
          enterKeyHint="done"
          placeholder="태그를 입력하세요"
          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
        />
        <button
          type="button"
          onClick={() => addTag(normalizedInput)}
          disabled={!normalizedInput || hasReachedLimit}
          aria-label="태그 추가"
          className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          추가
        </button>
      </div>
      {hasReachedLimit && (
        <p id={descriptionId} className="mt-1.5 text-xs text-slate-400">
          태그는 최대 {MAX_EXPENSE_TAGS}개까지 추가할 수 있어요.
        </p>
      )}

      {!hasReachedLimit && suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1" aria-label="기존 태그 선택">
          <span className="mr-0.5 text-xs text-slate-400">기존 태그</span>
          {suggestions.map((tag) => (
            <button
              type="button"
              key={tag}
              onClick={() => addTag(tag)}
              className="max-w-full break-all text-left text-xs leading-5 text-blue-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

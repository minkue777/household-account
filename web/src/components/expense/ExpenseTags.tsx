import { normalizeExpenseTags } from '@/lib/utils/expenseTags';

interface ExpenseTagsProps {
  tags?: string[];
  onTagClick?: (tag: string) => void;
}

export default function ExpenseTags({ tags, onTagClick }: ExpenseTagsProps) {
  const normalizedTags = normalizeExpenseTags(tags);
  if (normalizedTags.length === 0) return null;

  return (
    <span className="contents text-xs leading-4" aria-label="지출 태그">
      {normalizedTags.map((tag) => onTagClick ? (
        <button
          key={tag}
          type="button"
          draggable={false}
          onTouchStart={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onTagClick(tag);
          }}
          aria-label={`${tag} 태그 검색`}
          className="max-w-full break-all text-left text-blue-600 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          #{tag}
        </button>
      ) : (
        <span key={tag} className="max-w-full break-all text-blue-600">
          #{tag}
        </span>
      ))}
    </span>
  );
}

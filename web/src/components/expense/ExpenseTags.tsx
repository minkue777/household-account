import { normalizeExpenseTags } from '@/lib/utils/expenseTags';

interface ExpenseTagsProps {
  tags?: string[];
  onTagClick?: (tag: string) => void;
}

export default function ExpenseTags({ tags, onTagClick }: ExpenseTagsProps) {
  const normalizedTags = normalizeExpenseTags(tags);
  if (normalizedTags.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-wrap gap-1" aria-label="지출 태그">
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
          className="max-w-full truncate rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          #{tag}
        </button>
      ) : (
        <span key={tag} className="max-w-full truncate rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
          #{tag}
        </span>
      ))}
    </div>
  );
}

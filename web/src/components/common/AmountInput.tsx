'use client';

interface AmountInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/**
 * 금액 입력 컴포넌트 (원 단위 표시 포함)
 */
export default function AmountInput({
  value,
  onChange,
  placeholder = '0',
  className = '',
}: AmountInputProps) {
  return (
    <div className="relative">
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 pr-10 ${className}`}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
        원
      </span>
    </div>
  );
}

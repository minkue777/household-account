'use client';

interface ManualHoldingFormProps {
  name: string;
  onNameChange: (value: string) => void;
  currentValue: string;
  onCurrentValueChange: (value: string) => void;
  isAdding: boolean;
  onAdd: () => void;
}

export default function ManualHoldingForm({
  name,
  onNameChange,
  currentValue,
  onCurrentValueChange,
  isAdding,
  onAdd,
}: ManualHoldingFormProps) {
  return (
    <div className="border-b border-blue-200 bg-blue-100 p-4">
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">항목명</label>
          <input
            type="text"
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="항목명 입력"
            className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">금액</label>
          <div className="relative">
            <input
              type="text"
              inputMode="numeric"
              value={currentValue ? parseInt(currentValue, 10).toLocaleString() : ''}
              onChange={(e) => onCurrentValueChange(e.target.value)}
              placeholder="0"
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">원</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onAdd}
          disabled={!name.trim() || !currentValue || isAdding}
          className="w-full rounded-lg bg-blue-500 py-2.5 font-medium text-white transition-colors hover:bg-blue-600 disabled:bg-slate-300"
        >
          {isAdding ? '추가 중..' : '항목 추가'}
        </button>
      </div>
    </div>
  );
}

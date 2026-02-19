'use client';

export type PeriodPreset = '1month' | '3months' | '6months' | '1year' | 'custom';

export interface CustomDateRange {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
}

interface PeriodSelectorProps {
  periodPreset: PeriodPreset;
  onPresetChange: (preset: PeriodPreset) => void;
  customRange: CustomDateRange;
}

const PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: '1month', label: '이번달' },
  { key: '3months', label: '3개월' },
  { key: '6months', label: '6개월' },
  { key: '1year', label: '1년' },
  { key: 'custom', label: '직접 선택' },
];

export default function PeriodSelector({
  periodPreset,
  onPresetChange,
  customRange,
}: PeriodSelectorProps) {
  return (
    <>
      <div className="flex flex-wrap gap-2 mb-4">
        {PRESETS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onPresetChange(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              periodPreset === key
                ? 'bg-blue-500 text-white shadow-md'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 직접 선택 시 날짜 입력 */}
      {periodPreset === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
          <input
            type="month"
            value={customRange.startDate ? customRange.startDate.substring(0, 7) : ''}
            onChange={(e) => customRange.onStartDateChange(e.target.value ? `${e.target.value}-01` : '')}
            className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-slate-400">~</span>
          <input
            type="month"
            value={customRange.endDate ? customRange.endDate.substring(0, 7) : ''}
            onChange={(e) => {
              if (e.target.value) {
                const [year, month] = e.target.value.split('-');
                const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
                customRange.onEndDateChange(`${e.target.value}-${lastDay}`);
              } else {
                customRange.onEndDateChange('');
              }
            }}
            className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}
    </>
  );
}

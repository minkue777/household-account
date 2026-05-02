'use client';

import { useState } from 'react';
import { useTheme, THEMES } from '@/contexts/ThemeContext';
import { ChevronDown, Palette } from 'lucide-react';

export default function ThemeSettings() {
  const { theme, setTheme, themeConfig } = useTheme();

  // 섹션 펼침/접힘 상태
  const [isThemeOpen, setIsThemeOpen] = useState(false);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
      <button
        onClick={() => setIsThemeOpen(!isThemeOpen)}
        className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: themeConfig.preview }}
          >
            <Palette className="h-5 w-5 text-white drop-shadow" />
          </div>
          <div className="text-left">
            <div className="font-semibold text-slate-800">테마</div>
            <div className="text-sm text-slate-500">
              {themeConfig.label}
            </div>
          </div>
        </div>
        <ChevronDown
          className={`h-5 w-5 text-slate-400 transition-transform ${isThemeOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isThemeOpen && (
        <div className="border-t border-slate-100 p-4">
          <div className="grid grid-cols-2 gap-3">
            {THEMES.map((t) => (
              <button
                key={t.key}
                onClick={() => setTheme(t.key)}
                className={`p-3 rounded-xl border-2 text-left transition-all ${
                  theme === t.key
                    ? 'border-blue-500 ring-2 ring-blue-200'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div
                  className="w-full h-12 rounded-lg mb-2"
                  style={{ background: t.preview }}
                />
                <div className="font-medium text-slate-800 text-sm">{t.label}</div>
                <div className="text-xs text-slate-500">{t.description}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

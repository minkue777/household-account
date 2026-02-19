'use client';

import { useState } from 'react';
import { useTheme, THEMES } from '@/contexts/ThemeContext';

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
            <svg className="w-5 h-5 text-white drop-shadow" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
          </div>
          <div className="text-left">
            <div className="font-semibold text-slate-800">테마</div>
            <div className="text-sm text-slate-500">
              {themeConfig.label}
            </div>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-slate-400 transition-transform ${isThemeOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
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

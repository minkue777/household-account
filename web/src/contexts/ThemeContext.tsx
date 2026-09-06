'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export type ThemeType = 'default' | 'warm' | 'forest' | 'ocean' | 'mono';

export interface ThemeConfig {
  key: ThemeType;
  label: string;
  description: string;
  preview: string; // 미리보기용 그라데이션
  background: string;
  cardBg: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  titleGradient: string; // 타이틀 그라데이션 색상
}

export const THEMES: ThemeConfig[] = [
  {
    key: 'default',
    label: '파스텔 드림',
    description: '부드러운 파스텔 그라데이션',
    preview: 'linear-gradient(135deg, #f0f4ff 0%, #faf5ff 50%, #fff1f2 100%)',
    background: 'linear-gradient(135deg, #f0f4ff 0%, #faf5ff 50%, #fff1f2 100%)',
    cardBg: 'rgba(255, 255, 255, 0.96)',
    cardBorder: 'rgba(255, 255, 255, 0.5)',
    textPrimary: '#1e293b',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    accent: '#3b82f6',
    accentHover: '#2563eb',
    titleGradient: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
  },
  {
    key: 'warm',
    label: '선셋 웜',
    description: '따뜻한 노을 느낌',
    preview: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 50%, #fed7aa 100%)',
    background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 50%, #ffedd5 100%)',
    cardBg: 'rgba(255, 255, 255, 0.96)',
    cardBorder: 'rgba(251, 191, 36, 0.2)',
    textPrimary: '#78350f',
    textSecondary: '#92400e',
    textMuted: '#b45309',
    accent: '#f59e0b',
    accentHover: '#d97706',
    titleGradient: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)',
  },
  {
    key: 'forest',
    label: '포레스트',
    description: '자연의 초록빛',
    preview: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 50%, #bbf7d0 100%)',
    background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 50%, #dcfce7 100%)',
    cardBg: 'rgba(255, 255, 255, 0.96)',
    cardBorder: 'rgba(34, 197, 94, 0.2)',
    textPrimary: '#14532d',
    textSecondary: '#166534',
    textMuted: '#15803d',
    accent: '#22c55e',
    accentHover: '#16a34a',
    titleGradient: 'linear-gradient(135deg, #22c55e 0%, #059669 100%)',
  },
  {
    key: 'ocean',
    label: '오션 블루',
    description: '시원한 바다 느낌',
    preview: 'linear-gradient(135deg, #cffafe 0%, #a5f3fc 50%, #bae6fd 100%)',
    background: 'linear-gradient(135deg, #ecfeff 0%, #cffafe 50%, #e0f2fe 100%)',
    cardBg: 'rgba(255, 255, 255, 0.96)',
    cardBorder: 'rgba(6, 182, 212, 0.2)',
    textPrimary: '#164e63',
    textSecondary: '#155e75',
    textMuted: '#0e7490',
    accent: '#06b6d4',
    accentHover: '#0891b2',
    titleGradient: 'linear-gradient(135deg, #06b6d4 0%, #0284c7 100%)',
  },
  {
    key: 'mono',
    label: '미니멀 화이트',
    description: '깔끔한 흰색 기반',
    preview: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 50%, #f1f5f9 100%)',
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
    cardBg: 'rgba(255, 255, 255, 0.96)',
    cardBorder: 'rgba(226, 232, 240, 0.8)',
    textPrimary: '#0f172a',
    textSecondary: '#334155',
    textMuted: '#64748b',
    accent: '#6366f1',
    accentHover: '#4f46e5',
    titleGradient: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  },
];

interface ThemeContextType {
  theme: ThemeType;
  themeConfig: ThemeConfig;
  setTheme: (theme: ThemeType) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'app-theme';

function applyTheme(theme: ThemeType): boolean {
  const config = THEMES.find(value => value.key === theme);
  if (!config) return false;
  try {
    const root = document.documentElement;
    root.style.setProperty('--theme-background', config.background);
    root.style.setProperty('--theme-card-bg', config.cardBg);
    root.style.setProperty('--theme-card-border', config.cardBorder);
    root.style.setProperty('--theme-text-primary', config.textPrimary);
    root.style.setProperty('--theme-text-secondary', config.textSecondary);
    root.style.setProperty('--theme-text-muted', config.textMuted);
    root.style.setProperty('--theme-accent', config.accent);
    root.style.setProperty('--theme-accent-hover', config.accentHover);
    document.body.style.background = config.background;
    document.body.style.backgroundAttachment = 'fixed';
    return true;
  } catch { return false; }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeType>('default');
  useEffect(() => {
    let initial: ThemeType = 'default';
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (THEMES.some(value => value.key === saved)) initial = saved as ThemeType;
    } catch { /* 저장소가 없어도 기본 테마로 실행합니다. */ }
    if (applyTheme(initial)) setThemeState(initial);
  }, []);
  const setTheme = (newTheme: ThemeType) => {
    if (!applyTheme(newTheme)) return;
    setThemeState(newTheme);
    try { localStorage.setItem(STORAGE_KEY, newTheme); } catch { /* 현재 화면 선택은 유지합니다. */ }
  };
  const themeConfig = THEMES.find(value => value.key === theme) || THEMES[0];
  return <ThemeContext.Provider value={{ theme, themeConfig, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export type ThemeType = 'default' | 'warm' | 'forest' | 'ocean' | 'mono' | 'dark';

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
}

export const THEMES: ThemeConfig[] = [
  {
    key: 'default',
    label: '파스텔 드림',
    description: '부드러운 파스텔 그라데이션',
    preview: 'linear-gradient(135deg, #f0f4ff 0%, #faf5ff 50%, #fff1f2 100%)',
    background: 'linear-gradient(135deg, #f0f4ff 0%, #faf5ff 50%, #fff1f2 100%)',
    cardBg: 'rgba(255, 255, 255, 0.8)',
    cardBorder: 'rgba(255, 255, 255, 0.5)',
    textPrimary: '#1e293b',
    textSecondary: '#475569',
    textMuted: '#94a3b8',
    accent: '#3b82f6',
    accentHover: '#2563eb',
  },
  {
    key: 'warm',
    label: '선셋 웜',
    description: '따뜻한 노을 느낌',
    preview: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 50%, #fed7aa 100%)',
    background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 50%, #ffedd5 100%)',
    cardBg: 'rgba(255, 255, 255, 0.85)',
    cardBorder: 'rgba(251, 191, 36, 0.2)',
    textPrimary: '#78350f',
    textSecondary: '#92400e',
    textMuted: '#b45309',
    accent: '#f59e0b',
    accentHover: '#d97706',
  },
  {
    key: 'forest',
    label: '포레스트',
    description: '자연의 초록빛',
    preview: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 50%, #bbf7d0 100%)',
    background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 50%, #dcfce7 100%)',
    cardBg: 'rgba(255, 255, 255, 0.85)',
    cardBorder: 'rgba(34, 197, 94, 0.2)',
    textPrimary: '#14532d',
    textSecondary: '#166534',
    textMuted: '#15803d',
    accent: '#22c55e',
    accentHover: '#16a34a',
  },
  {
    key: 'ocean',
    label: '오션 블루',
    description: '시원한 바다 느낌',
    preview: 'linear-gradient(135deg, #cffafe 0%, #a5f3fc 50%, #bae6fd 100%)',
    background: 'linear-gradient(135deg, #ecfeff 0%, #cffafe 50%, #e0f2fe 100%)',
    cardBg: 'rgba(255, 255, 255, 0.85)',
    cardBorder: 'rgba(6, 182, 212, 0.2)',
    textPrimary: '#164e63',
    textSecondary: '#155e75',
    textMuted: '#0e7490',
    accent: '#06b6d4',
    accentHover: '#0891b2',
  },
  {
    key: 'mono',
    label: '미니멀 화이트',
    description: '깔끔한 흰색 기반',
    preview: 'linear-gradient(135deg, #ffffff 0%, #f8fafc 50%, #f1f5f9 100%)',
    background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
    cardBg: 'rgba(255, 255, 255, 0.95)',
    cardBorder: 'rgba(226, 232, 240, 0.8)',
    textPrimary: '#0f172a',
    textSecondary: '#334155',
    textMuted: '#64748b',
    accent: '#6366f1',
    accentHover: '#4f46e5',
  },
  {
    key: 'dark',
    label: '다크 모드',
    description: '눈이 편안한 어두운 테마',
    preview: 'linear-gradient(135deg, #1e293b 0%, #0f172a 50%, #020617 100%)',
    background: 'linear-gradient(180deg, #1e293b 0%, #0f172a 100%)',
    cardBg: 'rgba(30, 41, 59, 0.8)',
    cardBorder: 'rgba(51, 65, 85, 0.5)',
    textPrimary: '#f1f5f9',
    textSecondary: '#cbd5e1',
    textMuted: '#94a3b8',
    accent: '#60a5fa',
    accentHover: '#3b82f6',
  },
];

interface ThemeContextType {
  theme: ThemeType;
  themeConfig: ThemeConfig;
  setTheme: (theme: ThemeType) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const STORAGE_KEY = 'app-theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeType>('default');
  const [isLoaded, setIsLoaded] = useState(false);

  // localStorage에서 초기값 로드
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && THEMES.some(t => t.key === saved)) {
      setThemeState(saved as ThemeType);
    }
    setIsLoaded(true);
  }, []);

  // 테마 변경 시 CSS 변수 업데이트
  useEffect(() => {
    if (!isLoaded) return;

    const config = THEMES.find(t => t.key === theme) || THEMES[0];
    const root = document.documentElement;

    root.style.setProperty('--theme-background', config.background);
    root.style.setProperty('--theme-card-bg', config.cardBg);
    root.style.setProperty('--theme-card-border', config.cardBorder);
    root.style.setProperty('--theme-text-primary', config.textPrimary);
    root.style.setProperty('--theme-text-secondary', config.textSecondary);
    root.style.setProperty('--theme-text-muted', config.textMuted);
    root.style.setProperty('--theme-accent', config.accent);
    root.style.setProperty('--theme-accent-hover', config.accentHover);

    // body 배경 직접 설정
    document.body.style.background = config.background;
    document.body.style.backgroundAttachment = 'fixed';
  }, [theme, isLoaded]);

  const setTheme = (newTheme: ThemeType) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEY, newTheme);
  };

  const themeConfig = THEMES.find(t => t.key === theme) || THEMES[0];

  if (!isLoaded) {
    return (
      <ThemeContext.Provider value={{ theme: 'default', themeConfig: THEMES[0], setTheme }}>
        {children}
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, themeConfig, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

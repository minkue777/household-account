'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export type CalendarStyle = 'default' | 'modern';

interface CalendarStyleContextType {
  calendarStyle: CalendarStyle;
  setCalendarStyle: (style: CalendarStyle) => void;
}

const CalendarStyleContext = createContext<CalendarStyleContextType | undefined>(undefined);

const STORAGE_KEY = 'calendar-style';

export const CALENDAR_STYLES: { key: CalendarStyle; label: string; description: string }[] = [
  { key: 'default', label: '기본', description: '심플한 기본 스타일' },
  { key: 'modern', label: '미니멀 모던', description: '부드러운 글래스 효과' },
];

export function CalendarStyleProvider({ children }: { children: React.ReactNode }) {
  const [calendarStyle, setCalendarStyleState] = useState<CalendarStyle>('default');
  const [isLoaded, setIsLoaded] = useState(false);

  // localStorage에서 초기값 로드
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && ['default', 'desk', 'wall', 'flip', 'modern'].includes(saved)) {
      setCalendarStyleState(saved as CalendarStyle);
    }
    setIsLoaded(true);
  }, []);

  const setCalendarStyle = (style: CalendarStyle) => {
    setCalendarStyleState(style);
    localStorage.setItem(STORAGE_KEY, style);
  };

  // 로딩 중에는 기본값 사용
  if (!isLoaded) {
    return (
      <CalendarStyleContext.Provider value={{ calendarStyle: 'default', setCalendarStyle }}>
        {children}
      </CalendarStyleContext.Provider>
    );
  }

  return (
    <CalendarStyleContext.Provider value={{ calendarStyle, setCalendarStyle }}>
      {children}
    </CalendarStyleContext.Provider>
  );
}

export function useCalendarStyle(): CalendarStyleContextType {
  const context = useContext(CalendarStyleContext);
  if (context === undefined) {
    throw new Error('useCalendarStyle must be used within a CalendarStyleProvider');
  }
  return context;
}

// 스타일에 따른 CSS 클래스 반환
export function getCalendarStyleClass(style: CalendarStyle): string {
  switch (style) {
    case 'modern':
      return 'calendar-modern';
    default:
      return 'bg-white/60 backdrop-blur-sm rounded-2xl shadow-sm border border-white/50';
  }
}

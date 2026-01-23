'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';

export type CalendarStyle = 'elevation' | 'pressed' | 'glass';

interface CalendarStyleContextType {
  calendarStyle: CalendarStyle;
  setCalendarStyle: (style: CalendarStyle) => void;
}

const CalendarStyleContext = createContext<CalendarStyleContextType | undefined>(undefined);

const STORAGE_KEY = 'calendar-style';

export const CALENDAR_STYLES: { key: CalendarStyle; label: string; description: string }[] = [
  { key: 'elevation', label: 'Soft Elevation', description: '부드럽게 떠있는 느낌' },
  { key: 'pressed', label: 'Pressed Edge', description: '살짝 눌린 종이 느낌' },
  { key: 'glass', label: 'Glass Depth', description: '유리판 깊이감' },
];

export function CalendarStyleProvider({ children }: { children: React.ReactNode }) {
  const [calendarStyle, setCalendarStyleState] = useState<CalendarStyle>('elevation');
  const [isLoaded, setIsLoaded] = useState(false);

  // localStorage에서 초기값 로드
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && ['elevation', 'pressed', 'glass'].includes(saved)) {
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
      <CalendarStyleContext.Provider value={{ calendarStyle: 'elevation', setCalendarStyle }}>
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
    case 'pressed':
      return 'calendar-pressed';
    case 'glass':
      return 'calendar-glass';
    default:
      return 'calendar-elevation';
  }
}

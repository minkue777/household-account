'use client';

import React from 'react';

export function CalendarStyleProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

// 스타일 CSS 클래스 반환 (Glass Depth 고정)
export function getCalendarStyleClass(): string {
  return 'calendar-glass';
}

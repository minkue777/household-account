import { useState, useCallback } from 'react';

interface UseMonthNavigationOptions {
  initialYear?: number;
  initialMonth?: number;
}

interface UseMonthNavigationReturn {
  currentYear: number;
  currentMonth: number;
  slideDirection: 'left' | 'right' | null;
  goToPrevMonth: () => void;
  goToNextMonth: () => void;
  goToMonth: (year: number, month: number) => void;
  goToToday: () => void;
  formatYearMonth: () => string;
}

/**
 * 월 이동 로직 관리 훅
 * - 이전/다음 달 이동
 * - 특정 년월로 이동
 * - 슬라이드 애니메이션 방향 관리
 */
export function useMonthNavigation(options: UseMonthNavigationOptions = {}): UseMonthNavigationReturn {
  const today = new Date();
  const {
    initialYear = today.getFullYear(),
    initialMonth = today.getMonth() + 1,
  } = options;

  const [currentYear, setCurrentYear] = useState(initialYear);
  const [currentMonth, setCurrentMonth] = useState(initialMonth);
  const [slideDirection, setSlideDirection] = useState<'left' | 'right' | null>(null);

  // 이전 달 이동
  const goToPrevMonth = useCallback(() => {
    setSlideDirection('right');
    if (currentMonth === 1) {
      setCurrentYear(currentYear - 1);
      setCurrentMonth(12);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  }, [currentYear, currentMonth]);

  // 다음 달 이동
  const goToNextMonth = useCallback(() => {
    setSlideDirection('left');
    if (currentMonth === 12) {
      setCurrentYear(currentYear + 1);
      setCurrentMonth(1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  }, [currentYear, currentMonth]);

  // 특정 년월로 이동
  const goToMonth = useCallback((year: number, month: number) => {
    // 슬라이드 방향 결정
    const currentDate = currentYear * 12 + currentMonth;
    const targetDate = year * 12 + month;

    if (targetDate > currentDate) {
      setSlideDirection('left');
    } else if (targetDate < currentDate) {
      setSlideDirection('right');
    } else {
      setSlideDirection(null);
    }

    setCurrentYear(year);
    setCurrentMonth(month);
  }, [currentYear, currentMonth]);

  // 오늘 날짜로 이동
  const goToToday = useCallback(() => {
    const today = new Date();
    goToMonth(today.getFullYear(), today.getMonth() + 1);
  }, [goToMonth]);

  // 년월 포맷팅
  const formatYearMonth = useCallback(() => {
    return `${currentYear}년 ${currentMonth}월`;
  }, [currentYear, currentMonth]);

  return {
    currentYear,
    currentMonth,
    slideDirection,
    goToPrevMonth,
    goToNextMonth,
    goToMonth,
    goToToday,
    formatYearMonth,
  };
}

import { renderHook, act } from '@testing-library/react';
import { useMonthNavigation } from '@/hooks/useMonthNavigation';

describe('useMonthNavigation', () => {
  // 현재 날짜를 고정
  const mockDate = new Date('2024-06-15');
  const originalDate = global.Date;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(mockDate);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with current date by default', () => {
      const { result } = renderHook(() => useMonthNavigation());

      expect(result.current.currentYear).toBe(2024);
      expect(result.current.currentMonth).toBe(6);
      expect(result.current.slideDirection).toBeNull();
    });

    it('should initialize with provided date', () => {
      const { result } = renderHook(() =>
        useMonthNavigation({ initialYear: 2023, initialMonth: 12 })
      );

      expect(result.current.currentYear).toBe(2023);
      expect(result.current.currentMonth).toBe(12);
    });
  });

  describe('goToPrevMonth', () => {
    it('should go to previous month', () => {
      const { result } = renderHook(() =>
        useMonthNavigation({ initialYear: 2024, initialMonth: 6 })
      );

      act(() => {
        result.current.goToPrevMonth();
      });

      expect(result.current.currentYear).toBe(2024);
      expect(result.current.currentMonth).toBe(5);
      expect(result.current.slideDirection).toBe('right');
    });

    it('should go to previous year when at January', () => {
      const { result } = renderHook(() =>
        useMonthNavigation({ initialYear: 2024, initialMonth: 1 })
      );

      act(() => {
        result.current.goToPrevMonth();
      });

      expect(result.current.currentYear).toBe(2023);
      expect(result.current.currentMonth).toBe(12);
      expect(result.current.slideDirection).toBe('right');
    });
  });

  describe('goToNextMonth', () => {
    it('should go to next month', () => {
      const { result } = renderHook(() =>
        useMonthNavigation({ initialYear: 2024, initialMonth: 6 })
      );

      act(() => {
        result.current.goToNextMonth();
      });

      expect(result.current.currentYear).toBe(2024);
      expect(result.current.currentMonth).toBe(7);
      expect(result.current.slideDirection).toBe('left');
    });

    it('should go to next year when at December', () => {
      const { result } = renderHook(() =>
        useMonthNavigation({ initialYear: 2024, initialMonth: 12 })
      );

      act(() => {
        result.current.goToNextMonth();
      });

      expect(result.current.currentYear).toBe(2025);
      expect(result.current.currentMonth).toBe(1);
      expect(result.current.slideDirection).toBe('left');
    });
  });

  describe('goToMonth', () => {
    it('should go to specific month (forward)', () => {
      const { result } = renderHook(() =>
        useMonthNavigation({ initialYear: 2024, initialMonth: 1 })
      );

      act(() => {
        result.current.goToMonth(2024, 6);
      });

      expect(result.current.currentYear).toBe(2024);
      expect(result.current.currentMonth).toBe(6);
      expect(result.current.slideDirection).toBe('left');
    });

    it('should go to specific month (backward)', () => {
      const { result } = renderHook(() =>
        useMonthNavigation({ initialYear: 2024, initialMonth: 6 })
      );

      act(() => {
        result.current.goToMonth(2024, 1);
      });

      expect(result.current.currentYear).toBe(2024);
      expect(result.current.currentMonth).toBe(1);
      expect(result.current.slideDirection).toBe('right');
    });

    it('should go to different year (forward)', () => {
      const { result } = renderHook(() =>
        useMonthNavigation({ initialYear: 2024, initialMonth: 6 })
      );

      act(() => {
        result.current.goToMonth(2025, 3);
      });

      expect(result.current.currentYear).toBe(2025);
      expect(result.current.currentMonth).toBe(3);
      expect(result.current.slideDirection).toBe('left');
    });

    it('should go to different year (backward)', () => {
      const { result } = renderHook(() =>
        useMonthNavigation({ initialYear: 2024, initialMonth: 6 })
      );

      act(() => {
        result.current.goToMonth(2023, 1);
      });

      expect(result.current.currentYear).toBe(2023);
      expect(result.current.currentMonth).toBe(1);
      expect(result.current.slideDirection).toBe('right');
    });

    it('should set null direction for same month', () => {
      const { result } = renderHook(() =>
        useMonthNavigation({ initialYear: 2024, initialMonth: 6 })
      );

      act(() => {
        result.current.goToMonth(2024, 6);
      });

      expect(result.current.slideDirection).toBeNull();
    });
  });

  describe('goToToday', () => {
    it('should go to current date', () => {
      const { result } = renderHook(() =>
        useMonthNavigation({ initialYear: 2020, initialMonth: 1 })
      );

      act(() => {
        result.current.goToToday();
      });

      expect(result.current.currentYear).toBe(2024);
      expect(result.current.currentMonth).toBe(6);
      expect(result.current.slideDirection).toBe('left');
    });
  });

  describe('formatYearMonth', () => {
    it('should format year and month in Korean', () => {
      const { result } = renderHook(() =>
        useMonthNavigation({ initialYear: 2024, initialMonth: 6 })
      );

      expect(result.current.formatYearMonth()).toBe('2024년 6월');
    });

    it('should update format after month change', () => {
      const { result } = renderHook(() =>
        useMonthNavigation({ initialYear: 2024, initialMonth: 6 })
      );

      act(() => {
        result.current.goToNextMonth();
      });

      expect(result.current.formatYearMonth()).toBe('2024년 7월');
    });
  });
});

/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { ThemeProvider, useTheme, THEMES, ThemeType } from '@/contexts/ThemeContext';

// 테스트용 컴포넌트
function TestComponent() {
  const { theme, themeConfig, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="label">{themeConfig.label}</span>
      <button onClick={() => setTheme('warm')}>Set Warm</button>
      <button onClick={() => setTheme('forest')}>Set Forest</button>
    </div>
  );
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    // CSS 변수 초기화
    document.documentElement.style.cssText = '';
    document.body.style.cssText = '';
  });

  describe('THEMES constant', () => {
    it('should have 5 themes', () => {
      expect(THEMES).toHaveLength(5);
    });

    it('should have all required theme keys', () => {
      const keys = THEMES.map(t => t.key);
      expect(keys).toContain('default');
      expect(keys).toContain('warm');
      expect(keys).toContain('forest');
      expect(keys).toContain('ocean');
      expect(keys).toContain('mono');
    });

    it('should have all required properties in each theme', () => {
      THEMES.forEach(theme => {
        expect(theme).toHaveProperty('key');
        expect(theme).toHaveProperty('label');
        expect(theme).toHaveProperty('description');
        expect(theme).toHaveProperty('preview');
        expect(theme).toHaveProperty('background');
        expect(theme).toHaveProperty('cardBg');
        expect(theme).toHaveProperty('cardBorder');
        expect(theme).toHaveProperty('textPrimary');
        expect(theme).toHaveProperty('textSecondary');
        expect(theme).toHaveProperty('textMuted');
        expect(theme).toHaveProperty('accent');
        expect(theme).toHaveProperty('accentHover');
        expect(theme).toHaveProperty('titleGradient');
      });
    });
  });

  describe('ThemeProvider', () => {
    it('should provide default theme initially', async () => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      // useEffect 대기
      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('default');
      expect(screen.getByTestId('label')).toHaveTextContent('파스텔 드림');
    });

    it('should load theme from localStorage', async () => {
      localStorage.setItem('app-theme', 'warm');

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('warm');
      expect(screen.getByTestId('label')).toHaveTextContent('선셋 웜');
    });

    it('should ignore invalid theme from localStorage', async () => {
      localStorage.setItem('app-theme', 'invalid-theme');

      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('default');
    });

    it('should change theme and save to localStorage', async () => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      const warmButton = screen.getByText('Set Warm');

      act(() => {
        warmButton.click();
      });

      expect(screen.getByTestId('theme')).toHaveTextContent('warm');
      expect(localStorage.getItem('app-theme')).toBe('warm');
    });

    it('should apply CSS variables when theme changes', async () => {
      render(
        <ThemeProvider>
          <TestComponent />
        </ThemeProvider>
      );

      await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      const warmButton = screen.getByText('Set Warm');

      act(() => {
        warmButton.click();
      });

      const warmTheme = THEMES.find(t => t.key === 'warm')!;
      expect(document.documentElement.style.getPropertyValue('--theme-accent')).toBe(warmTheme.accent);
    });
  });

  describe('useTheme', () => {
    it('should throw error when used outside provider', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      expect(() => {
        render(<TestComponent />);
      }).toThrow('useTheme must be used within a ThemeProvider');

      consoleErrorSpy.mockRestore();
    });
  });
});

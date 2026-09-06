import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';

function Controls() { const { theme, setTheme } = useTheme(); return <><span>{theme}</span><button onClick={() => setTheme('forest')}>변경</button></>; }
describe('실제 ThemeProvider 저장소/DOM 장애', () => {
  afterEach(() => jest.restoreAllMocks());
  it('storage 읽기/쓰기 실패에도 기본 테마와 사용자 선택을 표시한다', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('disabled'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('disabled'); });
    render(<ThemeProvider><Controls /></ThemeProvider>);
    expect(screen.getByText('default')).toBeInTheDocument();
    fireEvent.click(screen.getByText('변경'));
    expect(screen.getByText('forest')).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue('--theme-accent')).toBe('#22c55e');
  });
  it('DOM 적용 실패 시 선택/영속 저장을 바꾸지 않는다', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('unknown-theme');
    const write = jest.spyOn(Storage.prototype, 'setItem');
    render(<ThemeProvider><Controls /></ThemeProvider>);
    jest.spyOn(document.documentElement.style, 'setProperty').mockImplementation(() => { throw new Error('DOM failure'); });
    fireEvent.click(screen.getByText('변경'));
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
  });
});

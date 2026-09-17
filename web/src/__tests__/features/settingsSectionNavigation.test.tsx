import { act, fireEvent, render, screen } from '@testing-library/react';
import ThemeSettings from '@/components/settings/ThemeSettings';
import { ThemeProvider } from '@/contexts/ThemeContext';

let mockPathname = '/settings';
jest.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
const settings = () => <ThemeProvider><ThemeSettings /></ThemeProvider>;
const heading = () => screen.getByRole('button', { name: /^테마/ });
const option = () => screen.queryByRole('button', { name: /^선셋 웜/ });
beforeEach(() => { mockPathname = '/settings'; localStorage.clear(); });

it('collapses when navigating away and returning while preserving the selected theme', () => {
  const view = render(settings());
  expect(option()).not.toBeInTheDocument();
  fireEvent.click(heading());
  fireEvent.click(screen.getByRole('button', { name: /^선셋 웜/ }));
  expect(option()).toBeVisible();
  mockPathname = '/assets';
  view.rerender(settings());
  mockPathname = '/settings';
  view.rerender(settings());
  expect(option()).not.toBeInTheDocument();
  expect(heading()).toHaveAttribute('aria-expanded', 'false');
  expect(heading()).toHaveTextContent('선셋 웜');
  expect(localStorage.getItem('app-theme')).toBe('warm');
});

it.each(['pagehide', 'pageshow'] as const)('collapses for %s without relying on component remount', eventName => {
  render(settings());
  fireEvent.click(heading());
  expect(option()).toBeVisible();
  act(() => window.dispatchEvent(new PageTransitionEvent(eventName, { persisted: true })));
  expect(option()).not.toBeInTheDocument();
  fireEvent.click(heading());
  expect(option()).toBeVisible();
});

it('keeps the current section open across same-page renders and ordinary app focus', () => {
  const view = render(settings());
  fireEvent.click(heading());
  view.rerender(settings());
  act(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
  });
  expect(option()).toBeVisible();
});

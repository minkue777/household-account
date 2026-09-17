import { fireEvent, render, screen } from '@testing-library/react';
import MonthlyTrendChart from '@/components/MonthlyTrendChart';
import DonutChart from '@/components/DonutChart';
import type { Expense } from '@/types/expense';

const mockLineInputs: Array<{ data: any; options: any }> = [];
const mockDonutInputs: Array<{ data: any; options: any }> = [];
const mockCategories = [
  { key: 'food', label: '식비', color: '#123456' },
  { key: 'custom', label: '간식', color: '#654321' },
];
const mockCategoryContext = {
  activeCategories: mockCategories,
  getCategoryLabel: (key: string) => mockCategories.find(category => category.key === key)?.label ?? key,
  getCategoryColor: (key: string) => mockCategories.find(category => category.key === key)?.color ?? '#000000',
};
jest.mock('@/contexts/CategoryContext', () => ({ useCategoryContext: () => mockCategoryContext }));
// The actual components aggregate and prepare chart inputs. Only canvas drawing is replaced.
jest.mock('react-chartjs-2', () => {
  const { forwardRef } = jest.requireActual('react');
  return {
    Line: (props: { data: any; options: any }) => { mockLineInputs.push(props); return <canvas />; },
    Doughnut: forwardRef((props: { data: any; options: any }, _ref: unknown) => { mockDonutInputs.push(props); return <canvas />; }),
    getElementAtEvent: jest.fn(),
  };
});
const rows: Expense[] = [
  { id: 'a', aggregateVersion: 1, date: '2026-08-01', amount: 100, category: 'food', merchant: '식당' },
  { id: 'b', aggregateVersion: 1, date: '2026-09-01', amount: 30, category: 'custom', merchant: '카페' },
  { id: 'c', aggregateVersion: 1, date: '2026-09-02', amount: -10, category: 'custom', merchant: '취소' },
];
beforeEach(() => { mockLineInputs.length = 0; mockDonutInputs.length = 0; });

it('keeps trend inputs stable across parent status renders, but updates enabled series and changed amounts', () => {
  const { rerender } = render(<MonthlyTrendChart expenses={rows} startDate="2026-08-01" endDate="2026-09-30" />);
  const initial = mockLineInputs.at(-1)!;
  expect(initial.data.datasets[0].data).toEqual([100, 20]);
  expect(initial.options.animation).toEqual({ duration: 150 });
  rerender(<MonthlyTrendChart expenses={rows} startDate="2026-08-01" endDate="2026-09-30" />);
  expect(mockLineInputs.at(-1)!.data).toBe(initial.data);
  expect(mockLineInputs.at(-1)!.options).toBe(initial.options);
  fireEvent.click(screen.getByRole('button', { name: '간식' }));
  const toggled = mockLineInputs.at(-1)!;
  expect(toggled.data.datasets.map((dataset: any) => dataset.data)).toEqual([[100, 20], [0, 20]]);
  expect(toggled.options).toBe(initial.options);
  rerender(<MonthlyTrendChart expenses={rows.map(row => row.id === 'b' ? { ...row, amount: 50 } : row)} startDate="2026-08-01" endDate="2026-09-30" />);
  expect(mockLineInputs.at(-1)!.data.datasets.map((dataset: any) => dataset.data)).toEqual([[100, 40], [0, 40]]);
});

it('keeps donut inputs stable across parent status renders while detail clicks use the current rows', () => {
  const firstClick = jest.fn();
  const { rerender } = render(<DonutChart expenses={rows} onCategoryClick={firstClick} />);
  const initial = mockDonutInputs.at(-1)!;
  expect(initial.data.labels).toEqual(['식비', '간식']);
  expect(initial.data.datasets[0].data).toEqual([100, 20]);
  expect(screen.getByText('120')).toBeInTheDocument();
  expect(initial.options.animation).toEqual({ duration: 150 });
  const currentClick = jest.fn();
  rerender(<DonutChart expenses={rows} onCategoryClick={currentClick} />);
  expect(mockDonutInputs.at(-1)!.data).toBe(initial.data);
  expect(mockDonutInputs.at(-1)!.options).toBe(initial.options);
  fireEvent.click(screen.getByRole('button', { name: /간식/ }));
  expect(firstClick).not.toHaveBeenCalled();
  expect(currentClick).toHaveBeenCalledWith('custom', rows.slice(1));
  const updated = rows.map(row => row.id === 'b' ? { ...row, amount: 50, memo: '변경됨' } : row);
  rerender(<DonutChart expenses={updated} onCategoryClick={currentClick} />);
  expect(mockDonutInputs.at(-1)!.data.datasets[0].data).toEqual([100, 40]);
  expect(screen.getByText('140')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /간식/ }));
  expect(currentClick).toHaveBeenLastCalledWith('custom', updated.slice(1));
});

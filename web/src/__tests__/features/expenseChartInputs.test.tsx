import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { getElementAtEvent } from 'react-chartjs-2';
import MonthlyTrendChart from '@/components/MonthlyTrendChart';
import DonutChart from '@/components/DonutChart';
import type { Expense } from '@/types/expense';

const mockLineInputs: Array<{ data: any; options: any }> = [];
const mockDonutInputs: Array<{ data: any; options: any }> = [];
const mockCategories = [
  { key: 'food', label: '식비', color: '#123456' },
  { key: 'custom', label: '간식', color: '#654321' },
  { key: 'inactive', label: '종료된 분류', color: '#abcdef' },
];
const mockCategoryContext = {
  activeCategories: mockCategories.slice(0, 2),
  getCategoryLabel: (key: string) => mockCategories.find(category => category.key === key)?.label ?? key,
  getCategoryColor: (key: string) => mockCategories.find(category => category.key === key)?.color ?? '#000000',
};
jest.mock('@/contexts/CategoryContext', () => ({ useCategoryContext: () => mockCategoryContext }));
// Actual components prepare the inputs and handle clicks; only canvas drawing is replaced.
jest.mock('react-chartjs-2', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual('react');
  return {
    Line: (props: { data: any; options: any }) => {
      mockLineInputs.push(props);
      return <canvas data-testid="trend-chart" />;
    },
    Doughnut: forwardRef((props: { data: any; options: any; onClick: any }, ref: unknown) => {
      useImperativeHandle(ref, () => ({}), []);
      mockDonutInputs.push(props);
      return <canvas data-testid="donut-chart" onClick={props.onClick} />;
    }),
    getElementAtEvent: jest.fn(),
  };
});
const rows: Expense[] = [
  { id: 'a', aggregateVersion: 1, date: '2026-08-01', amount: 100, category: 'food', merchant: '식당' },
  { id: 'b', aggregateVersion: 1, date: '2026-09-01', amount: 30, category: 'custom', merchant: '카페' },
  { id: 'c', aggregateVersion: 1, date: '2026-09-02', amount: -10, category: 'custom', merchant: '취소' },
];
function ControlledTrend({ expenses }: { expenses: Expense[] }) {
  const [enabled, setEnabled] = useState(() => new Set(['all']));
  return (
    <MonthlyTrendChart
      expenses={expenses}
      startDate="2026-08-01"
      endDate="2026-09-30"
      enabledCategories={enabled}
      onCategoryToggle={setEnabled}
    />
  );
}
beforeEach(() => {
  mockLineInputs.length = 0;
  mockDonutInputs.length = 0;
  jest.mocked(getElementAtEvent).mockReset().mockReturnValue([]);
});

it('keeps trend inputs stable across parent status renders, but updates enabled series and changed amounts', () => {
  const original = rows.map(row => ({ ...row }));
  const { rerender } = render(<ControlledTrend expenses={rows} />);
  const initial = mockLineInputs.at(-1)!;
  expect(initial.data.datasets[0].data).toEqual([100, 20]);
  expect(initial.options.animation).toEqual({ duration: 150 });
  const renders = mockLineInputs.length;
  rerender(<ControlledTrend expenses={rows} />);
  expect(mockLineInputs).toHaveLength(renders);
  expect(mockLineInputs.at(-1)!.data).toBe(initial.data);
  expect(mockLineInputs.at(-1)!.options).toBe(initial.options);
  fireEvent.click(screen.getByRole('button', { name: '간식' }));
  const toggled = mockLineInputs.at(-1)!;
  expect(toggled.data.datasets.map((dataset: any) => dataset.data)).toEqual([[100, 20], [0, 20]]);
  expect(toggled.options).toBe(initial.options);
  rerender(<ControlledTrend expenses={rows.map(row => row.id === 'b' ? { ...row, amount: 50 } : row)} />);
  expect(mockLineInputs.at(-1)!.data.datasets.map((dataset: any) => dataset.data)).toEqual([[100, 40], [0, 40]]);
  expect(rows).toEqual(original);
});

it('keeps empty trend months and includes inactive or unknown categories only in the total', () => {
  const expenses: Expense[] = [
    rows[0],
    { ...rows[1], date: '2026-10-01' },
    { ...rows[2], date: '2026-10-02' },
    { ...rows[0], id: 'inactive', category: 'inactive', amount: 7 },
    { ...rows[0], id: 'unknown', category: 'unknown', amount: 13 },
    { ...rows[0], id: 'outside', date: '2026-07-31', amount: 999 },
  ];
  render(<MonthlyTrendChart expenses={expenses} startDate="2026-08-01" endDate="2026-10-31"
    enabledCategories={new Set(['all', 'food', 'custom', 'inactive', 'unknown'])} onCategoryToggle={jest.fn()} />);
  const { labels, datasets } = mockLineInputs.at(-1)!.data;
  expect(labels).toEqual(['26.08', '26.09', '26.10']);
  expect(datasets).toEqual([
    { label: '전체', data: [120, 0, 20], borderColor: '#3B82F6', backgroundColor: 'rgba(59, 130, 246, 0.1)',
      borderWidth: 3, fill: true, tension: 0.3, pointRadius: 4, pointHoverRadius: 6 },
    { label: '식비', data: [100, 0, 0], borderColor: '#123456', backgroundColor: '#12345620',
      borderWidth: 2, fill: false, tension: 0.3, pointRadius: 3, pointHoverRadius: 5 },
    { label: '간식', data: [0, 0, 20], borderColor: '#654321', backgroundColor: '#65432120',
      borderWidth: 2, fill: false, tension: 0.3, pointRadius: 3, pointHoverRadius: 5 },
  ]);
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['전체', '식비', '간식']);
  expect(screen.getByRole('button', { name: '전체' })).toHaveClass('bg-blue-500');
  expect(screen.getByRole('button', { name: '전체' }).querySelector('span')).toBeNull();
  expect(screen.getByRole('button', { name: '식비' })).toHaveStyle({ backgroundColor: '#123456' });
});

it('uses the latest parent trend selection and callback without changing the supplied selection', () => {
  const firstChange = jest.fn();
  const currentChange = jest.fn();
  const initialSelection = new Set(['all']);
  const props = { expenses: rows, startDate: '2026-08-01', endDate: '2026-09-30' };
  const { rerender } = render(<MonthlyTrendChart {...props} enabledCategories={initialSelection} onCategoryToggle={firstChange} />);
  const selection = new Set(['custom']);
  rerender(<MonthlyTrendChart {...props} enabledCategories={selection} onCategoryToggle={currentChange} />);
  expect(mockLineInputs.at(-1)!.data.datasets.map((dataset: any) => dataset.label)).toEqual(['간식']);
  expect(screen.getByRole('button', { name: '전체' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('button', { name: '간식' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: '식비' }));
  expect(firstChange).not.toHaveBeenCalled();
  expect(currentChange).toHaveBeenCalledWith(new Set(['custom', 'food']));
  expect(selection).toEqual(new Set(['custom']));
  expect(initialSelection).toEqual(new Set(['all']));
  rerender(<MonthlyTrendChart {...props} enabledCategories={new Set()} onCategoryToggle={currentChange} />);
  expect(screen.queryByTestId('trend-chart')).not.toBeInTheDocument();
  expect(screen.getByText('카테고리를 선택하세요')).toBeInTheDocument();
});

it('preserves consecutive trend toggles through the controlling parent including empty selection', () => {
  render(<ControlledTrend expenses={rows} />);
  for (const name of ['간식', '식비', '전체', '간식']) {
    fireEvent.click(screen.getByRole('button', { name }));
  }
  expect(mockLineInputs.at(-1)!.data.datasets.map((dataset: any) => dataset.label)).toEqual(['식비']);
  fireEvent.click(screen.getByRole('button', { name: '식비' }));
  expect(screen.getByText('카테고리를 선택하세요')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '전체' }));
  expect(mockLineInputs.at(-1)!.data.datasets.map((dataset: any) => dataset.data)).toEqual([[100, 20]]);
});

it('keeps donut inputs stable while legend clicks use the latest callback and totals use the current rows', () => {
  const original = rows.map(row => ({ ...row }));
  const firstClick = jest.fn();
  const { rerender } = render(<DonutChart expenses={rows} onCategoryClick={firstClick} />);
  const initial = mockDonutInputs.at(-1)!;
  expect(initial.data.labels).toEqual(['식비', '간식']);
  expect(initial.data.datasets[0].data).toEqual([100, 20]);
  expect(screen.getByText('120')).toBeInTheDocument();
  expect(initial.options.animation).toEqual({ duration: 150 });
  const renders = mockDonutInputs.length;
  rerender(<DonutChart expenses={rows} onCategoryClick={firstClick} />);
  expect(mockDonutInputs).toHaveLength(renders);
  const currentClick = jest.fn();
  rerender(<DonutChart expenses={rows} onCategoryClick={currentClick} />);
  expect(mockDonutInputs.at(-1)!.data).toBe(initial.data);
  expect(mockDonutInputs.at(-1)!.options).toBe(initial.options);
  fireEvent.click(screen.getByRole('button', { name: /간식/ }));
  expect(firstClick).not.toHaveBeenCalled();
  expect(currentClick).toHaveBeenCalledWith('custom');
  const updated = rows.map(row => row.id === 'b' ? { ...row, amount: 50, memo: '변경됨' } : row);
  rerender(<DonutChart expenses={updated} onCategoryClick={currentClick} />);
  expect(mockDonutInputs.at(-1)!.data.datasets[0].data).toEqual([100, 40]);
  expect(screen.getByText('140')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /간식/ }));
  expect(currentClick).toHaveBeenLastCalledWith('custom');
  expect(rows).toEqual(original);
});

it('resolves donut canvas indices from the latest amount ordering and current callback', () => {
  const firstClick = jest.fn();
  const { rerender } = render(<DonutChart expenses={rows} onCategoryClick={firstClick} />);
  jest.mocked(getElementAtEvent).mockReturnValue([{ index: 0 }] as ReturnType<typeof getElementAtEvent>);
  fireEvent.click(screen.getByTestId('donut-chart'));
  expect(firstClick).toHaveBeenCalledWith('food');
  const currentClick = jest.fn();
  const updated = rows.map(row => row.id === 'b' ? { ...row, amount: 210 } : row);
  rerender(<DonutChart expenses={updated} onCategoryClick={currentClick} />);
  expect(mockDonutInputs.at(-1)!.data.labels).toEqual(['간식', '식비']);
  fireEvent.click(screen.getByTestId('donut-chart'));
  expect(currentClick).toHaveBeenCalledWith('custom');
  expect(firstClick).toHaveBeenCalledTimes(1);
  jest.mocked(getElementAtEvent).mockReturnValue([]);
  fireEvent.click(screen.getByTestId('donut-chart'));
  expect(currentClick).toHaveBeenCalledTimes(1);
});

it('keeps stable positive donut ordering while zero and negative categories remain in the total', () => {
  const expenses: Expense[] = [
    { ...rows[0], id: 'custom', category: 'custom', amount: 100 },
    rows[0],
    { ...rows[0], id: 'zero', category: 'zero', amount: 0 },
    { ...rows[0], id: 'negative', category: 'negative', amount: -20 },
    { ...rows[0], id: 'unknown', category: 'unknown', amount: 50 },
  ];
  render(<DonutChart expenses={expenses} onCategoryClick={jest.fn()} />);
  expect(mockDonutInputs.at(-1)!.data.labels).toEqual(['간식', '식비', 'unknown']);
  expect(mockDonutInputs.at(-1)!.data.datasets[0].data).toEqual([100, 100, 50]);
  expect(screen.getByText('230')).toBeInTheDocument();
  expect(screen.getAllByText('43%')).toHaveLength(2);
  expect(screen.getByText('22%')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /zero|negative/ })).not.toBeInTheDocument();
});

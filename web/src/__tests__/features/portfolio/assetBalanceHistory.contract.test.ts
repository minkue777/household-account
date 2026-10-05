import { withCurrentAssetBalance, type AssetBalancePoint } from '@/features/reporting/assetBalanceHistory';

const today = '2026-10-05';
function entry(date: string, balance: number, changeAmount = 0): AssetBalancePoint {
  return { date, balance, changeAmount };
}

it('keeps missing history distinct from a confirmed current zero balance', () => {
  expect(withCurrentAssetBalance([], undefined, today)).toEqual([]);
  expect(withCurrentAssetBalance([], 0, today)).toEqual([{ date: today, balance: 0, changeAmount: 0 }]);
});

it('preserves the complete ordered series by reference before current assets are confirmed', () => {
  const history = Object.freeze([Object.freeze(entry('2026-10-01', 300)), Object.freeze(entry('2026-10-06', 400, 100))]);
  expect(withCurrentAssetBalance(history, undefined, today)).toBe(history);
});

it('replaces only today, uses the closest earlier balance, and preserves future points and the source', () => {
  const history = Object.freeze([
    Object.freeze(entry('2026-09-01', 500)),
    Object.freeze(entry('2026-10-01', 800, 300)),
    Object.freeze(entry(today, 1000, 200)),
    Object.freeze(entry('2026-10-06', 1500, 500)),
  ]);
  const before = JSON.stringify(history);
  expect(withCurrentAssetBalance(history, 1200, today)).toEqual([
    entry('2026-09-01', 500), entry('2026-10-01', 800, 300), entry(today, 1200, 400), entry('2026-10-06', 1500, 500),
  ]);
  expect(JSON.stringify(history)).toBe(before);
});

it.each([
  { history: [entry('2026-10-06', 400, 100)], expected: [entry(today, 100, 0), entry('2026-10-06', 400, 100)] },
  { history: [entry('2026-10-01', 50), entry('2026-10-06', 400, 100)], expected: [entry('2026-10-01', 50), entry(today, 100, 50), entry('2026-10-06', 400, 100)] },
  { history: [entry('2026-10-01', 50)], expected: [entry('2026-10-01', 50), entry(today, 100, 50)] },
])('inserts an absent current point at its chronological position: $history', ({ history, expected }) => {
  const before = JSON.stringify(history);
  expect(withCurrentAssetBalance(history, 100, today)).toEqual(expected);
  expect(JSON.stringify(history)).toBe(before);
});

it('preserves the recorded change when today is the first observation', () => {
  expect(withCurrentAssetBalance([entry(today, 1000, 200)], 1000, today))
    .toEqual([{ date: today, balance: 1000, changeAmount: 200 }]);
});

it('uses an observed zero as the earlier baseline', () => {
  expect(withCurrentAssetBalance([entry('2026-10-01', 0), entry(today, 10, 10)], 50, today).at(-1))
    .toEqual({ date: today, balance: 50, changeAmount: 50 });
});

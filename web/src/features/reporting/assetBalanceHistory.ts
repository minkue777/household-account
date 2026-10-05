export interface AssetBalancePoint {
  date: string;
  balance: number;
  changeAmount: number;
}

/** The read model supplies one point per date in ascending order for this series. */
export function withCurrentAssetBalance(
  history: readonly AssetBalancePoint[],
  currentBalance: number | undefined,
  today: string,
): readonly AssetBalancePoint[] {
  if (currentBalance === undefined) return history;

  const nextIndex = history.findIndex(point => point.date >= today);
  const index = nextIndex < 0 ? history.length : nextIndex;
  const recordedToday = history[index]?.date === today ? history[index] : undefined;
  const baseline = history[index - 1]?.balance ?? (recordedToday ? recordedToday.balance - recordedToday.changeAmount : undefined);
  const current: AssetBalancePoint = {
    date: today,
    balance: currentBalance,
    changeAmount: baseline === undefined ? 0 : currentBalance - baseline,
  };
  return [...history.slice(0, index), current, ...history.slice(index + (recordedToday ? 1 : 0))];
}

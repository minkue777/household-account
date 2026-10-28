import { afterEach, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { createFirebaseHouseholdQueryRegistry } from "../../src/bootstrap/householdQueryRegistry";
import { FirebasePortfolioDividendProjectionReader } from "../../src/adapters/firebase/portfolio/firebasePortfolioDividendProjectionReader";
import { NaverDividendYieldReader } from "../../src/adapters/http/naverDividendYieldReader";

afterEach(() => { vi.restoreAllMocks(); });

it("[MARKET-001] combines published yield with stored dividends and retains the projection on provider failure", async () => {
  const projection = { code: '368590', name: 'ETF', recentDividend: 88, paymentDate: '2026-10-02', frequency: 1, dividendYield: null, annualDividendPerShare: 88, isEstimated: false as const, paymentEvents: [{ paymentDate: '2026-10-02', dividend: 88 }] };
  vi.spyOn(FirebasePortfolioDividendProjectionReader.prototype, 'read').mockResolvedValue(projection);
  const yieldReader = vi.spyOn(NaverDividendYieldReader.prototype, 'read').mockResolvedValue(0.64);
  const handler = createFirebaseHouseholdQueryRegistry({} as Firestore).get('portfolio.get-dividend-projection.v1')!;
  const context = {
    envelope: { contractVersion: 'household-query.v1' as const, queryId: 'query-1', householdId: 'house-1', query: 'portfolio.get-dividend-projection.v1', payload: { instrumentCode: '368590' } },
    principalUid: 'user-1', actor: { principalUid: 'user-1', householdId: 'house-1', actingMemberId: 'member-1', capabilities: [] },
  };
  expect(handler.usesExternalQueryQuota).toBe(true);
  await expect(handler.execute(context)).resolves.toEqual({ ...projection, dividendYield: 0.64 });
  yieldReader.mockRejectedValue(new Error('TIMEOUT'));
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  await expect(handler.execute(context)).resolves.toEqual(projection);
  expect(warn).toHaveBeenCalledWith('DIVIDEND_YIELD_UNAVAILABLE');
});

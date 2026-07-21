import type * as firestore from "firebase-admin/firestore";
import { describe, expect, it, vi } from "vitest";

import { FirebasePortfolioDividendProjectionReader } from "../../../src/adapters/firebase/portfolio/firebasePortfolioDividendProjectionReader";

describe("FirebasePortfolioDividendProjectionReader", () => {
  it("reads only the selected household projection and derives the trailing-year summary", async () => {
    const get = vi.fn(async () => ({
      docs: [
        {
          data: () => ({
            householdId: "house-1",
            events: {
              "event-1": {
                eventId: "event-1",
                stockCode: "005930",
                stockName: "삼성전자",
                paymentDate: "2025-09-01",
                perShareAmount: 360,
              },
              "event-2": {
                eventId: "event-2",
                instrumentCode: "005930",
                instrumentName: "삼성전자",
                paymentDate: "2026-06-01",
                perShareAmount: 365,
              },
              "other-stock": {
                eventId: "event-3",
                stockCode: "000660",
                stockName: "SK하이닉스",
                paymentDate: "2026-05-01",
                perShareAmount: 300,
              },
            },
          }),
        },
      ],
    }));
    const where = vi.fn(() => ({ get }));
    const database = {
      collection: vi.fn(() => ({ where })),
    } as unknown as firestore.Firestore;
    const subject = new FirebasePortfolioDividendProjectionReader(database);

    await expect(
      subject.read({
        householdId: "house-1",
        instrumentCode: "005930",
        asOfDate: "2026-07-21",
      }),
    ).resolves.toEqual({
      code: "005930",
      name: "삼성전자",
      recentDividend: 365,
      paymentDate: "2026-06-01",
      frequency: 2,
      dividendYield: null,
      annualDividendPerShare: 725,
      isEstimated: false,
      paymentEvents: [
        { paymentDate: "2025-09-01", dividend: 360 },
        { paymentDate: "2026-06-01", dividend: 365 },
      ],
    });
    expect(where).toHaveBeenCalledWith("householdId", "==", "house-1");
  });

  it("returns an explicit empty projection instead of fabricating dividend data", async () => {
    const database = {
      collection: () => ({
        where: () => ({ get: async () => ({ docs: [] }) }),
      }),
    } as unknown as firestore.Firestore;
    const subject = new FirebasePortfolioDividendProjectionReader(database);

    await expect(
      subject.read({
        householdId: "house-1",
        instrumentCode: "005930",
        asOfDate: "2026-07-21",
      }),
    ).resolves.toEqual({
      code: "005930",
      name: "005930",
      recentDividend: null,
      paymentDate: null,
      frequency: null,
      dividendYield: null,
      annualDividendPerShare: null,
      isEstimated: false,
      paymentEvents: [],
    });
  });
});

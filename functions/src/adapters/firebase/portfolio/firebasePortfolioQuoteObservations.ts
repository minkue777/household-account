import type * as firestore from "firebase-admin/firestore";
import type { ExchangeRateObservation } from "../../../contexts/portfolio/holdings/public";

export interface SourceMarketObservation {
  readonly sourcePrice: number;
  readonly observedAt: string;
  readonly provider: string;
}

/** Public provider observations survive process restarts independently of any household valuation. */
export class FirebasePortfolioQuoteObservations {
  constructor(private readonly database: firestore.Firestore) {}

  private reference(key: string) {
    return this.database.collection("operations").doc("runtime").collection("marketObservations").doc(key);
  }

  async source(symbol: string): Promise<SourceMarketObservation | undefined> {
    return (await this.reference(`USD_${symbol}`).get()).data() as SourceMarketObservation | undefined;
  }

  async rate(): Promise<ExchangeRateObservation | undefined> {
    return (await this.reference("USD_KRW").get()).data() as ExchangeRateObservation | undefined;
  }

  async saveSource(symbol: string, observation: SourceMarketObservation): Promise<SourceMarketObservation> {
    const reference = this.reference(`USD_${symbol}`);
    return this.database.runTransaction(async transaction => {
      const current = (await transaction.get(reference)).data() as SourceMarketObservation | undefined;
      if (current !== undefined && current.observedAt >= observation.observedAt) return current;
      transaction.set(reference, { ...observation });
      return observation;
    });
  }

  async saveRate(observation: ExchangeRateObservation): Promise<ExchangeRateObservation> {
    const reference = this.reference("USD_KRW");
    return this.database.runTransaction(async transaction => {
      const current = (await transaction.get(reference)).data() as ExchangeRateObservation | undefined;
      if (current !== undefined && (current.rateDate > observation.rateDate || (current.rateDate === observation.rateDate && current.observedAt >= observation.observedAt))) return current;
      transaction.set(reference, { ...observation });
      return observation;
    });
  }
}

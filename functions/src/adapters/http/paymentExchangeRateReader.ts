import type { PaymentExchangeRatePort } from "../../contexts/payment-capture/android-payment-ingestion/application/ports/out/paymentExchangeRatePort";
import { createSafeExternalTextHttpApplication } from "../../platform/external-operations/application/safeExternalTextHttpApplication";
import type { SafeExternalTextHttpInputPort } from "../../platform/external-operations/application/ports/in/safeExternalTextHttpInputPort";
import { parseLocalDate } from "../../platform/shared-kernel/seoulDateTime";
import { NodeExternalTextHttpTransport } from "./nodeExternalTextHttpTransport";

type Rate = NonNullable<Awaited<ReturnType<PaymentExchangeRatePort["getYenRate"]>>>;

/** Frankfurter의 ECB 고시 환율만 사용합니다. 결제 정보는 외부로 보내지 않습니다. */
export class PaymentExchangeRateReader implements PaymentExchangeRatePort {
  private readonly cached = new Map<string, { value: Rate; expiresAt: number }>();
  constructor(private readonly http: SafeExternalTextHttpInputPort = createSafeExternalTextHttpApplication({
    policy: { providers: [{ provider: "frankfurter-ecb", allowedHosts: ["api.frankfurter.dev"],
      allowedPorts: [443], maxRedirectHops: 0 }], timeoutMs: 5_000, maxAttempts: 1, maxResponseBytes: 16_384 },
    transport: new NodeExternalTextHttpTransport(),
  })) {}

  async getYenRate(date: string): Promise<Rate | undefined> {
    if (parseLocalDate(date).kind !== "success") return undefined;
    const cached = this.cached.get(date);
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.value;
    try {
      const response = await this.http.execute({ provider: "frankfurter-ecb", operation: "payment-exchange-rate",
        url: `https://api.frankfurter.dev/v2/rate/JPY/KRW?date=${date}&providers=ECB`,
        headers: { Accept: "application/json" } });
      if (response.kind !== "success") return undefined;
      const data = JSON.parse(response.body);
      if (data?.base !== "JPY" || data.quote !== "KRW" || typeof data.rate !== "number" ||
          !Number.isFinite(data.rate) || data.rate <= 0 || typeof data.date !== "string" ||
          parseLocalDate(data.date).kind !== "success" || data.date > date) return undefined;
      const value: Rate = { rateInWon: data.rate, rateDate: data.date, provider: "frankfurter-ecb" };
      if (this.cached.size >= 32) this.cached.clear();
      this.cached.set(date, { value, expiresAt: Date.now() + 300_000 });
      return value;
    } catch { return undefined; }
  }
}

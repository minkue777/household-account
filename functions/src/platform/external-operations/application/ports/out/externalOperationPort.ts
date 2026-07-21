import type { ExternalResult } from "../../../domain/externalResult";

export interface ExternalOperationPort<T> {
  execute(): Promise<ExternalResult<T>>;
}

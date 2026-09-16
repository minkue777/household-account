/** Technical retry classification shared by real HTTP adapters. */
export function retryableHttpStatusCode(status: number):
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | undefined {
  if (status === 408) return "TIMEOUT";
  if (status === 429) return "RATE_LIMITED";
  return status >= 500 ? "PROVIDER_UNAVAILABLE" : undefined;
}

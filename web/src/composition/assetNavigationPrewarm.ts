const ASSET_NAVIGATION_WARM_WINDOW_MS = 30_000;

let assetWarmSubscription: (() => void) | undefined;
let warmInFlight: Promise<void> | undefined;
let catalogWarmCompleted = false;

/**
 * Prepares the asset read model only after the user signals navigation intent.
 * The temporary listener is bounded so keyboard focus without navigation does not
 * keep an unrelated Firestore subscription alive for the whole session.
 */
export function warmAssetNavigationIntent(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.resolve();
  }
  if (warmInFlight) return warmInFlight;
  if (assetWarmSubscription && catalogWarmCompleted) return Promise.resolve();

  warmInFlight = Promise.all([
    assetWarmSubscription
      ? Promise.resolve()
      : import('@/lib/assetService').then(({ subscribeToAssets }) => {
          if (assetWarmSubscription) return;
          assetWarmSubscription = subscribeToAssets(() => {});
          window.setTimeout(() => {
            assetWarmSubscription?.();
            assetWarmSubscription = undefined;
          }, ASSET_NAVIGATION_WARM_WINDOW_MS);
        }),
    catalogWarmCompleted
      ? Promise.resolve()
      : import('@/composition/stockInstrumentCatalogRuntime')
          .then(({ warmStockInstrumentCatalog }) => warmStockInstrumentCatalog())
          .then(() => {
            catalogWarmCompleted = true;
          }),
  ])
    .then(() => {})
    .finally(() => {
      warmInFlight = undefined;
    });

  return warmInFlight;
}

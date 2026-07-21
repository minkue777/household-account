import { createQuickEditSplitDraftApplication } from "../reference/android-host/application/quickEditSplitDraftApplication";

export function createQuickEditSplitDraftFixture() {
  let sequence = 0;
  return createQuickEditSplitDraftApplication({
    identities: { nextItemId: () => `split-item-${++sequence}` },
  });
}

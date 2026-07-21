import { createThemePreferenceApplication } from "../../src/platform/home-preferences/application/themePreferenceApplication";
import type { ThemeKey } from "../../src/platform/home-preferences/public";

export function createThemePreferenceFixture(fixture: {
  readonly storedValue?: string | null;
  readonly storageReadFailure?: boolean;
  readonly storageWriteFailure?: boolean;
  readonly domApplyFailure?: boolean;
  readonly domApplyFailureOnCall?: number;
} = {}) {
  const writes: string[] = [];
  const themes: ThemeKey[] = [];
  let domApplyCalls = 0;
  const application = createThemePreferenceApplication({
    storage: {
      async read() {
        if (fixture.storageReadFailure) throw new Error("STORAGE_READ_FAILED");
        return fixture.storedValue;
      },
      async write(theme) {
        if (fixture.storageWriteFailure) throw new Error("STORAGE_WRITE_FAILED");
        writes.push(theme);
      },
    },
    dom: {
      async apply(theme) {
        domApplyCalls += 1;
        if (
          fixture.domApplyFailure ||
          fixture.domApplyFailureOnCall === domApplyCalls
        ) {
          throw new Error("DOM_APPLY_FAILED");
        }
        themes.push(theme);
      },
    },
  });
  return {
    ...application,
    observedStorageWrites: () => [...writes],
    observedDomThemes: () => [...themes],
  };
}

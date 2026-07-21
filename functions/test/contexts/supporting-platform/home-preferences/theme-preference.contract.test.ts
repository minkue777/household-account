import { describe, expect, it } from "vitest";

import { createThemePreferenceFixture } from "../../../support/theme-preference-fixture";

type ThemeKey = "default" | "warm" | "forest" | "ocean" | "mono";

interface ThemePreferenceFixture {
  storedValue?: string | null;
  storageReadFailure?: boolean;
  storageWriteFailure?: boolean;
  domApplyFailure?: boolean;
  domApplyFailureOnCall?: number;
}

interface ThemeState {
  theme: ThemeKey;
  phase: "SSR" | "HYDRATED";
}

type ChangeThemeResult =
  | { kind: "success"; state: ThemeState }
  | { kind: "displayed-not-persisted"; state: ThemeState }
  | { kind: "apply-failure"; state: ThemeState };

export interface ThemePreferenceSubject {
  renderServer(): ThemeState;
  hydrateClient(): Promise<ThemeState>;
  changeTheme(theme: ThemeKey): Promise<ChangeThemeResult>;
  observedStorageWrites(): readonly string[];
  observedDomThemes(): readonly ThemeKey[];
}

export function createSubject(
  fixture: ThemePreferenceFixture = {},
): ThemePreferenceSubject {
  return createThemePreferenceFixture(fixture);
}

describe("Home Preferences 테마 계약", () => {
  it.each(["default", "warm", "forest", "ocean", "mono"] as const)(
    "[T-THEME-001][THEME-001] 유효한 저장 테마 %s를 hydration 후 복원·적용한다",
    async (theme) => {
      const subject = createSubject({ storedValue: theme });

      expect(subject.renderServer()).toEqual({ theme: "default", phase: "SSR" });
      expect(await subject.hydrateClient()).toEqual({ theme, phase: "HYDRATED" });
      expect(subject.observedDomThemes()).toEqual([theme]);
    },
  );

  it("[T-THEME-001][THEME-001] 알 수 없는 저장값은 default로 해석하되 default를 다시 저장하지 않는다", async () => {
    const subject = createSubject({ storedValue: "retired-theme" });

    expect(await subject.hydrateClient()).toEqual({
      theme: "default",
      phase: "HYDRATED",
    });
    expect(subject.observedStorageWrites()).toEqual([]);
  });

  it("[T-THEME-001][THEME-001] storage 읽기 실패에도 deterministic default 화면을 제공한다", async () => {
    const subject = createSubject({ storageReadFailure: true });

    expect(subject.renderServer()).toEqual({ theme: "default", phase: "SSR" });
    expect(await subject.hydrateClient()).toEqual({
      theme: "default",
      phase: "HYDRATED",
    });
  });

  it("[T-THEME-001][THEME-001] DOM 적용 성공 후 저장하며 저장 실패는 적용한 화면을 되돌리지 않는다", async () => {
    const subject = createSubject({ storageWriteFailure: true });

    expect(await subject.changeTheme("forest")).toEqual({
      kind: "displayed-not-persisted",
      state: { theme: "forest", phase: "HYDRATED" },
    });
    expect(subject.observedDomThemes()).toEqual(["forest"]);
  });

  it("[T-THEME-001][THEME-001] DOM 적용 실패 시 새 테마를 저장하거나 적용 완료로 확정하지 않는다", async () => {
    const subject = createSubject({
      storedValue: "warm",
      domApplyFailure: true,
    });

    expect(await subject.changeTheme("ocean")).toEqual({
      kind: "apply-failure",
      state: { theme: "default", phase: "HYDRATED" },
    });
    expect(subject.observedStorageWrites()).toEqual([]);
  });

  it("[T-THEME-001][THEME-001] 테마 변경 성공은 표시 상태와 저장값을 함께 갱신한다", async () => {
    const subject = createSubject();

    expect(await subject.changeTheme("ocean")).toEqual({
      kind: "success",
      state: { theme: "ocean", phase: "HYDRATED" },
    });
    expect(subject.observedDomThemes()).toEqual(["ocean"]);
    expect(subject.observedStorageWrites()).toEqual(["ocean"]);
  });

  it("[T-THEME-001][THEME-001] hydration 뒤 DOM 변경 실패는 직전에 표시하던 테마를 유지한다", async () => {
    const subject = createSubject({
      storedValue: "warm",
      domApplyFailureOnCall: 2,
    });
    await subject.hydrateClient();

    expect(await subject.changeTheme("forest")).toEqual({
      kind: "apply-failure",
      state: { theme: "warm", phase: "HYDRATED" },
    });
    expect(subject.observedStorageWrites()).toEqual([]);
  });
});

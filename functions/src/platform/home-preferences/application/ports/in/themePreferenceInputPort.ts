import type { ThemeKey } from "../../../domain/themePreference";

export type { ThemeKey } from "../../../domain/themePreference";

export interface ThemeState {
  readonly theme: ThemeKey;
  readonly phase: "SSR" | "HYDRATED";
}

export type ChangeThemeResult =
  | { readonly kind: "success"; readonly state: ThemeState }
  | { readonly kind: "displayed-not-persisted"; readonly state: ThemeState }
  | { readonly kind: "apply-failure"; readonly state: ThemeState };

export interface ThemePreferenceInputPort {
  renderServer(): ThemeState;
  hydrateClient(): Promise<ThemeState>;
  changeTheme(theme: ThemeKey): Promise<ChangeThemeResult>;
}

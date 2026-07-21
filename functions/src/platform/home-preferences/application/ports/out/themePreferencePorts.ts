import type { ThemeKey } from "../../../domain/themePreference";

export interface ThemeStoragePort {
  read(): Promise<string | null | undefined>;
  write(theme: ThemeKey): Promise<void>;
}

export interface ThemeDomPort {
  apply(theme: ThemeKey): Promise<void>;
}

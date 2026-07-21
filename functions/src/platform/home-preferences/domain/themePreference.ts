export const THEME_KEYS = ["default", "warm", "forest", "ocean", "mono"] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];

export function parseTheme(value: string | null | undefined): ThemeKey {
  return THEME_KEYS.includes(value as ThemeKey) ? (value as ThemeKey) : "default";
}

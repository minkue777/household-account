import { parseTheme } from "../domain/themePreference";
import type {
  ThemePreferenceInputPort,
  ThemeState,
} from "./ports/in/themePreferenceInputPort";
import type {
  ThemeDomPort,
  ThemeStoragePort,
} from "./ports/out/themePreferencePorts";

export function createThemePreferenceApplication(dependencies: {
  readonly storage: ThemeStoragePort;
  readonly dom: ThemeDomPort;
}): ThemePreferenceInputPort {
  let state: ThemeState = { theme: "default", phase: "SSR" };

  return {
    renderServer() {
      return { theme: "default", phase: "SSR" };
    },
    async hydrateClient() {
      let stored: string | null | undefined;
      try {
        stored = await dependencies.storage.read();
      } catch {
        stored = undefined;
      }
      const theme = parseTheme(stored);
      try {
        await dependencies.dom.apply(theme);
        state = { theme, phase: "HYDRATED" };
      } catch {
        state = { theme: "default", phase: "HYDRATED" };
      }
      return state;
    },
    async changeTheme(theme) {
      const previous = state.phase === "HYDRATED"
        ? state
        : { theme: "default" as const, phase: "HYDRATED" as const };
      try {
        await dependencies.dom.apply(theme);
      } catch {
        state = previous;
        return { kind: "apply-failure", state };
      }

      state = { theme, phase: "HYDRATED" };
      try {
        await dependencies.storage.write(theme);
        return { kind: "success", state };
      } catch {
        return { kind: "displayed-not-persisted", state };
      }
    },
  };
}

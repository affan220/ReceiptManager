import { useCallback, useEffect, useState } from "react";
import { loadThemePreference, saveThemePreference, ThemePreference } from "@/lib/DatabaseService";

export type Theme = ThemePreference;

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    loadThemePreference()
      .then((preference) => {
        if (active) setThemeState(preference);
      })
      .catch(() => {
        if (active) setThemeState("light");
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const setTheme = useCallback(async (nextTheme: Theme) => {
    const previousTheme = theme;
    setThemeState(nextTheme);
    try {
      await saveThemePreference(nextTheme);
    } catch (error) {
      setThemeState(previousTheme);
      throw error;
    }
  }, [theme]);

  const toggle = useCallback(() => setTheme(theme === "dark" ? "light" : "dark"), [theme, setTheme]);
  return { theme, ready, toggle, setTheme };
}

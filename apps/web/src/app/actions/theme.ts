"use server";

import { isTheme, setTheme } from "@/lib/theme";

/**
 * Persists the theme choice. Needs no auth: it only writes a display
 * preference cookie, and an unrecognised value is ignored rather than stored.
 * The layouts read the cookie on the next render, so calling this as an
 * action re-renders the scope with the new `data-theme` in the same round trip.
 */
export async function setThemeAction(theme: string): Promise<void> {
  if (!isTheme(theme)) return;
  await setTheme(theme);
}

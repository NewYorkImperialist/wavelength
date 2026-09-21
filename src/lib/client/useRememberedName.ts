"use client";

import { useCallback, useSyncExternalStore } from "react";

export const DISPLAY_NAME_KEY = "wl:displayName";

/**
 * The player's last-used display name, read from localStorage.
 *
 * `useSyncExternalStore` rather than an effect: it returns "" during SSR and
 * the stored value on the client with no setState, so there is no cascading
 * render and no hydration mismatch.
 */
export function useRememberedName(): string {
  const subscribe = useCallback((onChange: () => void) => {
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  }, []);

  return useSyncExternalStore(
    subscribe,
    () => window.localStorage.getItem(DISPLAY_NAME_KEY) ?? "",
    () => "",
  );
}

export function rememberName(name: string): void {
  window.localStorage.setItem(DISPLAY_NAME_KEY, name);
}

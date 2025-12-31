import type { DeckState } from "./types";
import { normalizeDeckState } from "./deckState";

const STORAGE_KEY = "slideai:deck:v1";

export type PersistedState = DeckState;

export function loadPersistedState(): PersistedState | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PersistedState;
    const normalized = normalizeDeckState(parsed);
    if (!normalized) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return normalized;
  } catch (error) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function savePersistedState(state: PersistedState): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // Ignore storage failures (quota, private mode, etc.)
  }
}

export function clearPersistedState(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

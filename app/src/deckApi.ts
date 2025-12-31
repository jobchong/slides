import type { DeckState } from "./types";

export interface DeckResponse {
  id: string;
  state: DeckState;
  createdAt: string;
  updatedAt: string;
}

const DECK_ID_KEY = "slideai:deck:id";

export function isServerDeckStorageEnabled(): boolean {
  const mode = import.meta.env.VITE_DECK_STORAGE;
  if (mode) return mode === "server";
  return !import.meta.env.DEV;
}

export function getStoredDeckId(): string | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
  return localStorage.getItem(DECK_ID_KEY);
}

export function setStoredDeckId(id: string): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  localStorage.setItem(DECK_ID_KEY, id);
}

export function clearStoredDeckId(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  localStorage.removeItem(DECK_ID_KEY);
}

function getServerUrl(): string {
  return import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
}

export async function createDeck(state: DeckState): Promise<DeckResponse> {
  const response = await fetch(`${getServerUrl()}/api/decks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Create deck failed with ${response.status}`);
  }

  return response.json();
}

export async function loadDeck(id: string): Promise<DeckResponse> {
  const response = await fetch(`${getServerUrl()}/api/decks/${id}`, {
    method: "GET",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Load deck failed with ${response.status}`);
  }

  return response.json();
}

export async function saveDeck(id: string, state: DeckState): Promise<DeckResponse> {
  const response = await fetch(`${getServerUrl()}/api/decks/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Save deck failed with ${response.status}`);
  }

  return response.json();
}

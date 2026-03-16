import type { DeckState } from "./types";

export interface DeckResponse {
  id: string;
  state: DeckState;
  createdAt: string;
  updatedAt: string;
}

export class DeckApiError extends Error {
  status?: number;

  constructor(message: string, options?: { status?: number }) {
    super(message);
    this.name = "DeckApiError";
    this.status = options?.status;
  }
}

const DECK_ID_KEY = "slideai:deck:id";
const REQUEST_TIMEOUT = 30_000;

/** Parse error response, handling both JSON and plain text */
async function parseErrorResponse(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return json.error || `Request failed with ${response.status}`;
  } catch {
    return text || `Request failed with ${response.status}`;
  }
}

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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  let response: Response;
  try {
    response = await fetch(`${getServerUrl()}/api/decks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new DeckApiError("Create deck request timed out");
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new DeckApiError(errorMessage, { status: response.status });
  }

  return response.json();
}

export async function loadDeck(id: string): Promise<DeckResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  let response: Response;
  try {
    response = await fetch(`${getServerUrl()}/api/decks/${id}`, {
      method: "GET",
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new DeckApiError("Load deck request timed out");
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new DeckApiError(errorMessage, { status: response.status });
  }

  return response.json();
}

export async function saveDeck(id: string, state: DeckState): Promise<DeckResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  let response: Response;
  try {
    response = await fetch(`${getServerUrl()}/api/decks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new DeckApiError("Save deck request timed out");
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new DeckApiError(errorMessage, { status: response.status });
  }

  return response.json();
}

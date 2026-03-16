import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

import {
  clearStoredDeckId,
  createDeck,
  DeckApiError,
  getStoredDeckId,
  isServerDeckStorageEnabled,
  loadDeck,
  saveDeck,
  setStoredDeckId,
} from "../deckApi";
import type { DeckState } from "../types";

const originalFetch = globalThis.fetch;

const sampleState: DeckState = {
  slides: [
    {
      id: "slide-1",
      html: "<div>Quarterly pipeline</div>",
      source: {
        background: { type: "none" },
        elements: [],
      },
    },
  ],
  currentSlideIndex: 0,
  messages: [{ role: "user", content: "Make it tighter" }],
  model: "auto",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("deckApi", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
  });

  test("creates a deck with the serialized state payload", async () => {
    let request: { url: string; method: string; body: unknown; contentType: string | null } | null = null;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      request = {
        url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        method: init?.method || "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        contentType: new Headers(init?.headers).get("Content-Type"),
      };

      return jsonResponse(
        {
          id: "deck-123",
          state: sampleState,
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z",
        },
        201
      );
    }) as unknown as typeof fetch;

    const result = await createDeck(sampleState);

    expect(result.id).toBe("deck-123");
    expect(result.state).toEqual(sampleState);
    expect(request).not.toBeNull();
    expect(request!).toEqual({
      url: "http://localhost:4000/api/decks",
      method: "POST",
      body: { state: sampleState },
      contentType: "application/json",
    });
  });

  test("surfaces JSON load errors as DeckApiError instances", async () => {
    globalThis.fetch = (async () => {
      return jsonResponse({ error: "Deck not found." }, 404);
    }) as unknown as typeof fetch;

    try {
      await loadDeck("missing-deck");
      throw new Error("Expected loadDeck to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DeckApiError);
      expect((error as DeckApiError).status).toBe(404);
      expect((error as DeckApiError).message).toBe("Deck not found.");
    }
  });

  test("surfaces plain-text save errors when JSON parsing is not available", async () => {
    globalThis.fetch = (async () => {
      return new Response("Try again later", { status: 503 });
    }) as unknown as typeof fetch;

    try {
      await saveDeck("deck-123", sampleState);
      throw new Error("Expected saveDeck to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DeckApiError);
      expect((error as DeckApiError).status).toBe(503);
      expect((error as DeckApiError).message).toBe("Try again later");
    }
  });

  test("stores and clears the persisted deck id", () => {
    expect(isServerDeckStorageEnabled()).toBe(true);
    expect(getStoredDeckId()).toBeNull();

    setStoredDeckId("deck-456");
    expect(getStoredDeckId()).toBe("deck-456");

    clearStoredDeckId();
    expect(getStoredDeckId()).toBeNull();
  });
});

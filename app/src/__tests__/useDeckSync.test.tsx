import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";

import { useDeckSync } from "../hooks/useDeckSync";
import type { Message, Slide } from "../types";

const originalFetch = globalThis.fetch;
const DECK_ID_KEY = "slideai:deck:id";

type HarnessSnapshot = {
  slides: Slide[];
  currentSlideIndex: number;
  messages: Message[];
  model: string;
  error: string | null;
  sync: ReturnType<typeof useDeckSync>;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createLocalSlides(): Slide[] {
  return [
    {
      id: "local-slide",
      html: "<div>Local slide</div>",
      source: {
        background: { type: "none" },
        elements: [],
      },
    },
  ];
}

describe("useDeckSync hydration", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    cleanup();
  });

  test("keeps the stored deck id when load fails temporarily", async () => {
    localStorage.setItem(DECK_ID_KEY, "deck-123");

    const requests: Array<{ url: string; method: string }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");
      requests.push({ url, method });

      if (url.endsWith("/api/decks/deck-123") && method === "GET") {
        return jsonResponse({ error: "Server exploded" }, 500);
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    let latest: HarnessSnapshot | null = null;

    function Harness() {
      const [slides, setSlides] = useState<Slide[]>(createLocalSlides);
      const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
      const [messages, setMessages] = useState<Message[]>([]);
      const [model, setModel] = useState("auto");
      const [error, setError] = useState<string | null>(null);
      const sync = useDeckSync({
        slides,
        currentSlideIndex,
        messages,
        model,
        setSlides,
        setCurrentSlideIndex,
        setMessages,
        setModel,
        setError,
      });

      useEffect(() => {
        latest = { slides, currentSlideIndex, messages, model, error, sync };
      }, [slides, currentSlideIndex, messages, model, error, sync]);

      return null;
    }

    render(<Harness />);

    await waitFor(() => {
      expect(latest).not.toBeNull();
      expect(latest!.sync.isHydrated).toBe(true);
    });

    expect(requests).toEqual([
      {
        url: "http://localhost:4000/api/decks/deck-123",
        method: "GET",
      },
    ]);
    expect(latest!.sync.deckId).toBe("deck-123");
    expect(localStorage.getItem(DECK_ID_KEY)).toBe("deck-123");
    expect(latest!.slides[0].id).toBe("local-slide");
    expect(latest!.error).toBe("Failed to load deck: Server exploded");
  });

  test("creates a replacement deck when the stored deck no longer exists", async () => {
    localStorage.setItem(DECK_ID_KEY, "deck-123");

    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");
      const body =
        typeof init?.body === "string"
          ? JSON.parse(init.body)
          : undefined;
      requests.push({ url, method, body });

      if (url.endsWith("/api/decks/deck-123") && method === "GET") {
        return jsonResponse({ error: "Deck not found." }, 404);
      }

      if (url.endsWith("/api/decks") && method === "POST") {
        return jsonResponse(
          {
            id: "deck-456",
            state: body?.state,
            createdAt: "2026-03-16T00:00:00.000Z",
            updatedAt: "2026-03-16T00:00:00.000Z",
          },
          201
        );
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    let latest: HarnessSnapshot | null = null;

    function Harness() {
      const [slides, setSlides] = useState<Slide[]>(createLocalSlides);
      const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
      const [messages, setMessages] = useState<Message[]>([]);
      const [model, setModel] = useState("auto");
      const [error, setError] = useState<string | null>(null);
      const sync = useDeckSync({
        slides,
        currentSlideIndex,
        messages,
        model,
        setSlides,
        setCurrentSlideIndex,
        setMessages,
        setModel,
        setError,
      });

      useEffect(() => {
        latest = { slides, currentSlideIndex, messages, model, error, sync };
      }, [slides, currentSlideIndex, messages, model, error, sync]);

      return null;
    }

    render(<Harness />);

    await waitFor(() => {
      expect(latest).not.toBeNull();
      expect(latest!.sync.isHydrated).toBe(true);
      expect(latest!.sync.deckId).toBe("deck-456");
    });

    expect(requests).toEqual([
      {
        url: "http://localhost:4000/api/decks/deck-123",
        method: "GET",
        body: undefined,
      },
      {
        url: "http://localhost:4000/api/decks",
        method: "POST",
        body: {
          state: {
            slides: createLocalSlides(),
            currentSlideIndex: 0,
            messages: [],
            model: "auto",
          },
        },
      },
    ]);
    expect(localStorage.getItem(DECK_ID_KEY)).toBe("deck-456");
    expect(latest!.slides[0].id).toBe("local-slide");
    expect(latest!.error).toBeNull();
  });
});

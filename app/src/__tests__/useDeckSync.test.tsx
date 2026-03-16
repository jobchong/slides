import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { useEffect, useState } from "react";

import { useDeckSync } from "../hooks/useDeckSync";
import type { Message, Slide } from "../types";

const originalFetch = globalThis.fetch;
const DECK_ID_KEY = "slideai:deck:id";
const PERSISTED_STATE_KEY = "slideai:deck:v1";
const originalDeckStorageMode = import.meta.env.VITE_DECK_STORAGE;

let originalConfirm: typeof window.confirm;

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

function setDeckStorageMode(mode?: string) {
  if (mode === undefined) {
    delete import.meta.env.VITE_DECK_STORAGE;
    return;
  }
  import.meta.env.VITE_DECK_STORAGE = mode;
}

function renderHarness(options?: {
  slides?: Slide[];
  currentSlideIndex?: number;
  messages?: Message[];
  model?: string;
  error?: string | null;
}) {
  let latest: HarnessSnapshot | null = null;

  function Harness() {
    const [slides, setSlides] = useState<Slide[]>(() => options?.slides ?? createLocalSlides());
    const [currentSlideIndex, setCurrentSlideIndex] = useState(options?.currentSlideIndex ?? 0);
    const [messages, setMessages] = useState<Message[]>(() => options?.messages ?? []);
    const [model, setModel] = useState(options?.model ?? "auto");
    const [error, setError] = useState<string | null>(options?.error ?? null);
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

  const view = render(<Harness />);

  return {
    getLatest() {
      if (!latest) {
        throw new Error("Harness snapshot not ready");
      }
      return latest;
    },
    unmount: view.unmount,
  };
}

describe("useDeckSync hydration", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
    originalConfirm = window.confirm;
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    localStorage.clear();
    window.confirm = originalConfirm;
    setDeckStorageMode(originalDeckStorageMode);
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

    const harness = renderHarness();

    await waitFor(() => {
      expect(harness.getLatest().sync.isHydrated).toBe(true);
    });

    expect(requests).toEqual([
      {
        url: "http://localhost:4000/api/decks/deck-123",
        method: "GET",
      },
    ]);
    expect(harness.getLatest().sync.deckId).toBe("deck-123");
    expect(localStorage.getItem(DECK_ID_KEY)).toBe("deck-123");
    expect(harness.getLatest().slides[0].id).toBe("local-slide");
    expect(harness.getLatest().error).toBe("Failed to load deck: Server exploded");
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

    const harness = renderHarness();

    await waitFor(() => {
      expect(harness.getLatest().sync.isHydrated).toBe(true);
      expect(harness.getLatest().sync.deckId).toBe("deck-456");
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
    expect(harness.getLatest().slides[0].id).toBe("local-slide");
    expect(harness.getLatest().error).toBeNull();
  });

  test("hydrates local state from a valid remote deck", async () => {
    localStorage.setItem(DECK_ID_KEY, "deck-remote");

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");

      if (url.endsWith("/api/decks/deck-remote") && method === "GET") {
        return jsonResponse({
          id: "deck-remote",
          state: {
            slides: [
              {
                id: "remote-slide",
                html: "<div onclick=\"alert(1)\"><script>bad()</script>Remote slide</div>",
                source: { background: { type: "none" }, elements: [] },
              },
            ],
            currentSlideIndex: 4,
            messages: [
              { role: "assistant", content: "Ready." },
              { role: "system", content: "Ignored" },
            ],
            model: "claude-sonnet",
          },
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z",
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const harness = renderHarness({ model: "auto" });

    await waitFor(() => {
      expect(harness.getLatest().sync.isHydrated).toBe(true);
      expect(harness.getLatest().slides[0]?.id).toBe("remote-slide");
    });

    expect(harness.getLatest().slides[0]?.html).toContain("Remote slide");
    expect(harness.getLatest().slides[0]?.html).not.toContain("script");
    expect(harness.getLatest().slides[0]?.html).not.toContain("onclick");
    expect(harness.getLatest().currentSlideIndex).toBe(0);
    expect(harness.getLatest().messages).toEqual([{ role: "assistant", content: "Ready." }]);
    expect(harness.getLatest().model).toBe("claude-sonnet");
    expect(harness.getLatest().error).toBeNull();
  });

  test("treats invalid remote deck payloads as load failures", async () => {
    localStorage.setItem(DECK_ID_KEY, "deck-invalid");

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");

      if (url.endsWith("/api/decks/deck-invalid") && method === "GET") {
        return jsonResponse({
          id: "deck-invalid",
          state: {
            slides: [],
            currentSlideIndex: 0,
            messages: [],
            model: "auto",
          },
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z",
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const harness = renderHarness();

    await waitFor(() => {
      expect(harness.getLatest().sync.isHydrated).toBe(true);
      expect(harness.getLatest().error).toBe(
        "Failed to load deck: Loaded deck state is invalid."
      );
    });

    expect(harness.getLatest().sync.deckId).toBe("deck-invalid");
    expect(harness.getLatest().slides[0]?.id).toBe("local-slide");
  });

  test("skips remote hydration when server storage is disabled", async () => {
    setDeckStorageMode("local");
    localStorage.setItem(DECK_ID_KEY, "deck-local-only");

    globalThis.fetch = (async () => {
      throw new Error("Remote deck fetch should not run in local mode");
    }) as unknown as typeof fetch;

    const harness = renderHarness();

    await waitFor(() => {
      expect(harness.getLatest().sync.isHydrated).toBe(true);
    });

    expect(harness.getLatest().sync.isServerStorageEnabled).toBe(false);
    expect(harness.getLatest().sync.deckId).toBe("deck-local-only");
    expect(harness.getLatest().slides[0]?.id).toBe("local-slide");
  });

  test("auto-saves hydrated decks after the debounce interval", async () => {
    localStorage.setItem(DECK_ID_KEY, "deck-autosave");

    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ url, method, body });

      if (url.endsWith("/api/decks/deck-autosave") && method === "GET") {
        return jsonResponse({
          id: "deck-autosave",
          state: {
            slides: [
              {
                id: "remote-slide",
                html: "<div>Remote slide</div>",
                source: { background: { type: "none" }, elements: [] },
              },
            ],
            currentSlideIndex: 0,
            messages: [{ role: "assistant", content: "Hydrated." }],
            model: "gpt-4.1",
          },
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z",
        });
      }

      if (url.endsWith("/api/decks/deck-autosave") && method === "PUT") {
        return jsonResponse({
          id: "deck-autosave",
          state: body?.state,
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:01:00.000Z",
        });
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const harness = renderHarness();

    await waitFor(() => {
      expect(harness.getLatest().sync.isHydrated).toBe(true);
    });

    await waitFor(
      () => {
        expect(requests.some((request) => request.method === "PUT")).toBe(true);
      },
      { timeout: 2000 }
    );

    const saveRequest = requests.find((request) => request.method === "PUT");
    expect(saveRequest).toEqual({
      url: "http://localhost:4000/api/decks/deck-autosave",
      method: "PUT",
      body: {
        state: {
          slides: harness.getLatest().slides,
          currentSlideIndex: 0,
          messages: [{ role: "assistant", content: "Hydrated." }],
          model: "gpt-4.1",
        },
      },
    });
    expect(harness.getLatest().error).toBeNull();
  });

  test("surfaces autosave failures", async () => {
    localStorage.setItem(DECK_ID_KEY, "deck-save-error");

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");

      if (url.endsWith("/api/decks/deck-save-error") && method === "GET") {
        return jsonResponse({
          id: "deck-save-error",
          state: {
            slides: [
              {
                id: "remote-slide",
                html: "<div>Remote slide</div>",
                source: { background: { type: "none" }, elements: [] },
              },
            ],
            currentSlideIndex: 0,
            messages: [],
            model: "auto",
          },
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z",
        });
      }

      if (url.endsWith("/api/decks/deck-save-error") && method === "PUT") {
        return jsonResponse({ error: "Save exploded" }, 500);
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const harness = renderHarness();

    await waitFor(() => {
      expect(harness.getLatest().sync.isHydrated).toBe(true);
    });

    await waitFor(
      () => {
        expect(harness.getLatest().error).toBe("Auto-save failed: Save exploded");
      },
      { timeout: 2000 }
    );
  });

  test("leaves the current deck intact when new-deck confirmation is cancelled", async () => {
    setDeckStorageMode("local");
    window.confirm = () => false;
    localStorage.setItem(DECK_ID_KEY, "deck-stable");

    const harness = renderHarness({
      messages: [{ role: "assistant", content: "Keep this" }],
      error: "Existing error",
    });

    await waitFor(() => {
      expect(harness.getLatest().sync.isHydrated).toBe(true);
    });

    act(() => {
      harness.getLatest().sync.handleNewDeck();
    });

    expect(harness.getLatest().sync.deckId).toBe("deck-stable");
    expect(harness.getLatest().slides[0]?.id).toBe("local-slide");
    expect(harness.getLatest().messages).toEqual([{ role: "assistant", content: "Keep this" }]);
    expect(harness.getLatest().error).toBe("Existing error");
  });

  test("creates and persists a fresh deck when starting over", async () => {
    localStorage.setItem(DECK_ID_KEY, "deck-123");
    localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        slides: createLocalSlides(),
        currentSlideIndex: 0,
        messages: [],
        model: "auto",
      })
    );
    window.confirm = () => true;

    const requests: Array<{ url: string; method: string; body?: unknown }> = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ url, method, body });

      if (url.endsWith("/api/decks/deck-123") && method === "GET") {
        return jsonResponse({
          id: "deck-123",
          state: {
            slides: createLocalSlides(),
            currentSlideIndex: 0,
            messages: [],
            model: "auto",
          },
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z",
        });
      }

      if (url.endsWith("/api/decks") && method === "POST") {
        return jsonResponse(
          {
            id: "deck-fresh",
            state: body?.state,
            createdAt: "2026-03-16T00:10:00.000Z",
            updatedAt: "2026-03-16T00:10:00.000Z",
          },
          201
        );
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const harness = renderHarness({
      messages: [{ role: "assistant", content: "Old chat" }],
      error: "Old error",
    });

    await waitFor(() => {
      expect(harness.getLatest().sync.isHydrated).toBe(true);
    });

    await act(async () => {
      harness.getLatest().sync.handleNewDeck();
    });

    await waitFor(() => {
      expect(harness.getLatest().sync.deckId).toBe("deck-fresh");
    });

    expect(localStorage.getItem(DECK_ID_KEY)).toBe("deck-fresh");
    expect(localStorage.getItem(PERSISTED_STATE_KEY)).toBeNull();
    expect(harness.getLatest().slides).toHaveLength(1);
    expect(harness.getLatest().slides[0]?.html).toBe("");
    expect(harness.getLatest().slides[0]?.source).toEqual({
      background: { type: "none" },
      elements: [],
    });
    expect(harness.getLatest().currentSlideIndex).toBe(0);
    expect(harness.getLatest().messages).toEqual([]);
    expect(harness.getLatest().error).toBeNull();
    expect(requests.filter((request) => request.method === "POST")).toHaveLength(1);
  });

  test("surfaces new-deck creation failures after clearing local state", async () => {
    localStorage.setItem(DECK_ID_KEY, "deck-123");
    window.confirm = () => true;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");

      if (url.endsWith("/api/decks/deck-123") && method === "GET") {
        return jsonResponse({
          id: "deck-123",
          state: {
            slides: createLocalSlides(),
            currentSlideIndex: 0,
            messages: [],
            model: "auto",
          },
          createdAt: "2026-03-16T00:00:00.000Z",
          updatedAt: "2026-03-16T00:00:00.000Z",
        });
      }

      if (url.endsWith("/api/decks") && method === "POST") {
        return jsonResponse({ error: "Create exploded" }, 500);
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const harness = renderHarness();

    await waitFor(() => {
      expect(harness.getLatest().sync.isHydrated).toBe(true);
    });

    await act(async () => {
      harness.getLatest().sync.handleNewDeck();
    });

    await waitFor(() => {
      expect(harness.getLatest().error).toBe("New deck creation failed: Create exploded");
    });

    expect(harness.getLatest().sync.deckId).toBeNull();
    expect(localStorage.getItem(DECK_ID_KEY)).toBeNull();
    expect(harness.getLatest().slides).toHaveLength(1);
    expect(harness.getLatest().slides[0]?.html).toBe("");
  });

  test("surfaces fallback deck creation failures during initial hydration", async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");

      if (url.endsWith("/api/decks") && method === "POST") {
        return jsonResponse({ error: "Deck store offline" }, 503);
      }

      throw new Error(`Unexpected request: ${method} ${url}`);
    }) as unknown as typeof fetch;

    const harness = renderHarness();

    await waitFor(() => {
      expect(harness.getLatest().sync.isHydrated).toBe(true);
      expect(harness.getLatest().error).toBe("Failed to create deck: Deck store offline");
    });

    expect(harness.getLatest().sync.deckId).toBeNull();
    expect(localStorage.getItem(DECK_ID_KEY)).toBeNull();
    expect(harness.getLatest().slides[0]?.id).toBe("local-slide");
  });
});

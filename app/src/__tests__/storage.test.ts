import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { clearPersistedState, loadPersistedState, savePersistedState } from "../storage";
import type { PersistedState } from "../storage";

const sampleState: PersistedState = {
  slides: [
    {
      id: "slide-1",
      html: "<div>Hello</div>",
      source: { background: { type: "none" }, elements: [] },
    },
  ],
  currentSlideIndex: 0,
  messages: [{ role: "user", content: "Make it bold" }],
  model: "gpt-4o",
};

describe("storage", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  beforeEach(() => {
    localStorage.clear();
  });

  test("loads a saved deck and clamps the index", () => {
    savePersistedState({ ...sampleState, currentSlideIndex: 3 });

    const loaded = loadPersistedState();

    expect(loaded).not.toBeNull();
    expect(loaded?.slides.length).toBe(1);
    expect(loaded?.currentSlideIndex).toBe(0);
    expect(loaded?.messages[0]?.content).toBe("Make it bold");
  });

  test("drops invalid storage payloads", () => {
    localStorage.setItem("slideai:deck:v1", "{broken json");

    const loaded = loadPersistedState();

    expect(loaded).toBeNull();
    expect(localStorage.getItem("slideai:deck:v1")).toBeNull();
  });

  test("sanitizes slide html when loading", () => {
    const unsafeState: PersistedState = {
      ...sampleState,
      slides: [
        {
          id: "slide-unsafe",
          html: "<div><script>alert('x')</script>Safe</div>",
        },
      ],
    };

    savePersistedState(unsafeState);

    const loaded = loadPersistedState();

    expect(loaded?.slides[0]?.html).toContain("Safe");
    expect(loaded?.slides[0]?.html).not.toContain("script");
  });

  test("clears storage explicitly", () => {
    savePersistedState(sampleState);
    clearPersistedState();

    expect(loadPersistedState()).toBeNull();
  });
});

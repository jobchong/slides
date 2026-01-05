import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeckStore } from "../deck-store";
import type { DeckState } from "../../app/src/types";

const sampleState: DeckState = {
  slides: [
    {
      id: "slide-1",
      html: "<div>Deck</div>",
      source: { background: { type: "none" }, elements: [] },
    },
  ],
  currentSlideIndex: 0,
  messages: [{ role: "user", content: "Hello" }],
  model: "gpt-4o",
};

describe("deck store", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "slideai-decks-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  test("creates, reads, and updates deck records", async () => {
    const store = createDeckStore({ mode: "fs", dir: workDir });

    const created = await store.create(sampleState);
    expect(created.id).toBeTruthy();
    expect(created.state.slides[0]?.id).toBe("slide-1");

    const loaded = await store.get(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.createdAt).toBe(created.createdAt);

    const updatedState: DeckState = {
      ...sampleState,
      messages: [...sampleState.messages, { role: "assistant", content: "Done." }],
    };
    const updated = await store.save(created.id, updatedState);

    expect(updated.createdAt).toBe(created.createdAt);
    const createdAt = Date.parse(created.createdAt);
    const updatedAt = Date.parse(updated.updatedAt);
    expect(updatedAt).toBeGreaterThanOrEqual(createdAt);
    expect(updated.state.messages.length).toBe(2);
  });
});

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeckStore, createDefaultDeckStore } from "../deck-store";
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

const originalSend = S3Client.prototype.send;
const originalEnv = {
  DECK_STORAGE: process.env.DECK_STORAGE,
  DECK_STORAGE_DIR: process.env.DECK_STORAGE_DIR,
  DECK_S3_BUCKET: process.env.DECK_S3_BUCKET,
  DECK_S3_PREFIX: process.env.DECK_S3_PREFIX,
  S3_BUCKET: process.env.S3_BUCKET,
  S3_REGION: process.env.S3_REGION,
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
  MAX_DECK_BYTES: process.env.MAX_DECK_BYTES,
};

async function expectStoreError(promise: Promise<unknown>, message: string) {
  try {
    await promise;
    throw new Error("Expected store operation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(message);
  }
}

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function installS3Mock(
  bodyFactory: (raw: string) => unknown = (raw) => raw
) {
  const objects = new Map<string, string>();
  const commands: Array<{ name: string; input: Record<string, unknown> }> = [];

  S3Client.prototype.send = (async function send(command: unknown) {
    const namedCommand = command as {
      constructor: { name: string };
      input: Record<string, unknown>;
    };
    commands.push({
      name: namedCommand.constructor.name,
      input: { ...namedCommand.input },
    });

    if (command instanceof PutObjectCommand) {
      objects.set(String(namedCommand.input.Key), String(namedCommand.input.Body ?? ""));
      return {};
    }

    if (command instanceof GetObjectCommand) {
      const key = String(namedCommand.input.Key);
      const raw = objects.get(key);
      if (!raw) {
        throw new Error("NoSuchKey");
      }
      return { Body: bodyFactory(raw) };
    }

    throw new Error(`Unexpected S3 command: ${namedCommand.constructor.name}`);
  }) as typeof S3Client.prototype.send;

  return { objects, commands };
}

describe("deck store", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "slideai-decks-"));
  });

  afterEach(async () => {
    S3Client.prototype.send = originalSend;
    restoreEnv();
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

  test("rejects invalid and oversized deck payloads in fs mode", async () => {
    const store = createDeckStore({ mode: "fs", dir: workDir, maxBytes: 32 });

    await expectStoreError(
      store.create({ ...sampleState, slides: [] }),
      "Deck must include at least one slide."
    );
    await expectStoreError(
      store.save("deck-invalid", {
        ...(sampleState as unknown as Record<string, unknown>),
        currentSlideIndex: 1.5,
      } as unknown as DeckState),
      "Deck currentSlideIndex must be an integer."
    );
    await expectStoreError(
      store.save("deck-invalid", {
        ...(sampleState as unknown as Record<string, unknown>),
        messages: null,
      } as unknown as DeckState),
      "Deck messages must be an array."
    );
    await expectStoreError(
      store.save("deck-invalid", {
        ...(sampleState as unknown as Record<string, unknown>),
        model: 42,
      } as unknown as DeckState),
      "Deck model must be a string."
    );
    await expectStoreError(
      store.create(sampleState),
      "Deck payload exceeds size limit."
    );
  });

  test("returns null for missing or malformed fs records", async () => {
    const store = createDeckStore({ mode: "fs", dir: workDir });

    expect(await store.get("missing")).toBeNull();

    await writeFile(
      join(workDir, "broken.json"),
      JSON.stringify({ version: 0, id: "broken", state: sampleState }),
      "utf-8"
    );
    expect(await store.get("broken")).toBeNull();

    await writeFile(join(workDir, "invalid-json.json"), "{not-json", "utf-8");
    expect(await store.get("invalid-json")).toBeNull();
  });

  test("requires an s3 bucket when creating an s3-backed store", () => {
    try {
      createDeckStore({ mode: "s3" });
      throw new Error("Expected createDeckStore to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Deck S3 bucket is required for s3 mode.");
    }
  });

  test("creates, reads, and saves deck records in s3 mode", async () => {
    const { commands } = installS3Mock(
      (raw) => new Uint8Array(new TextEncoder().encode(raw))
    );
    const store = createDeckStore({
      mode: "s3",
      bucket: "slides-bucket",
      prefix: "deck-prefix",
    });

    const created = await store.create(sampleState);
    const loaded = await store.get(created.id);
    const updated = await store.save(created.id, {
      ...sampleState,
      messages: [...sampleState.messages, { role: "assistant", content: "Done." }],
    });

    expect(commands[0]).toEqual({
      name: "PutObjectCommand",
      input: {
        Bucket: "slides-bucket",
        Key: `deck-prefix/${created.id}.json`,
        Body: commands[0]?.input.Body,
        ContentType: "application/json",
      },
    });
    expect(loaded?.id).toBe(created.id);
    expect(loaded?.state.slides[0]?.id).toBe("slide-1");
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.state.messages.at(-1)?.content).toBe("Done.");
    expect(commands.some((command) => command.name === "GetObjectCommand")).toBe(true);
  });

  test("supports transformToString and ReadableStream s3 bodies", async () => {
    const transformMock = installS3Mock((raw) => ({
      transformToString: async () => raw,
    }));
    const transformStore = createDeckStore({
      mode: "s3",
      bucket: "slides-bucket",
      prefix: "deck-prefix",
    });

    const created = await transformStore.create(sampleState);
    expect(await transformStore.get(created.id)).not.toBeNull();
    expect(transformMock.commands.some((command) => command.name === "GetObjectCommand")).toBe(true);

    const streamMock = installS3Mock((raw) => {
      const encoder = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(raw));
          controller.close();
        },
      });
    });
    const streamStore = createDeckStore({
      mode: "s3",
      bucket: "slides-bucket",
      prefix: "deck-prefix",
    });
    streamMock.objects.set(
      "deck-prefix/manual.json",
      JSON.stringify({
        version: 1,
        id: "manual",
        state: sampleState,
        createdAt: "2026-03-16T00:00:00.000Z",
        updatedAt: "2026-03-16T00:00:00.000Z",
      })
    );

    const loaded = await streamStore.get("manual");
    expect(loaded?.id).toBe("manual");
  });

  test("returns null for malformed s3 payloads and sanitizes object keys", async () => {
    const textMock = installS3Mock((raw) => ({
      text: async () => raw,
    }));
    const store = createDeckStore({
      mode: "s3",
      bucket: "slides-bucket",
      prefix: "deck-prefix",
    });

    textMock.objects.set("deck-prefix/bad.json", "{not-json");
    expect(await store.get("bad")).toBeNull();

    await store.save("deck/../unsafe", sampleState);
    const lastCommand = textMock.commands.at(-1);
    expect(lastCommand?.name).toBe("PutObjectCommand");
    expect(lastCommand?.input.Key).toBe("deck-prefix/deckunsafe.json");
  });

  test("creates default fs stores from environment configuration", async () => {
    process.env.DECK_STORAGE = "fs";
    process.env.DECK_STORAGE_DIR = workDir;

    const store = createDefaultDeckStore();
    const created = await store.create(sampleState);

    expect(await store.get(created.id)).not.toBeNull();
  });

  test("requires a bucket in default s3 mode", () => {
    process.env.DECK_STORAGE = "s3";
    delete process.env.DECK_S3_BUCKET;
    delete process.env.S3_BUCKET;

    try {
      createDefaultDeckStore();
      throw new Error("Expected createDefaultDeckStore to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(
        "DECK_S3_BUCKET or S3_BUCKET is required for deck storage."
      );
    }
  });

  test("creates default s3 stores from environment configuration", async () => {
    const mock = installS3Mock();
    process.env.DECK_STORAGE = "s3";
    process.env.DECK_S3_BUCKET = "env-bucket";
    process.env.DECK_S3_PREFIX = "env-prefix";
    process.env.S3_REGION = "ap-southeast-1";
    process.env.S3_FORCE_PATH_STYLE = "true";

    const store = createDefaultDeckStore();
    const created = await store.create(sampleState);

    expect(created.id).toBeTruthy();
    expect(mock.commands[0]?.input.Bucket).toBe("env-bucket");
    expect(String(mock.commands[0]?.input.Key)).toContain("env-prefix/");
  });
});

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { DeckState } from "../app/src/types";

export interface DeckRecord {
  id: string;
  state: DeckState;
  createdAt: string;
  updatedAt: string;
}

export interface DeckStore {
  create(state: DeckState): Promise<DeckRecord>;
  get(id: string): Promise<DeckRecord | null>;
  save(id: string, state: DeckState): Promise<DeckRecord>;
}

export interface DeckStoreOptions {
  mode?: "fs" | "s3";
  dir?: string;
  bucket?: string;
  prefix?: string;
  region?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const VERSION = 1;

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

function ensureDeckState(state: DeckState): DeckState {
  if (!Array.isArray(state.slides) || state.slides.length === 0) {
    throw new Error("Deck must include at least one slide.");
  }
  if (!Number.isInteger(state.currentSlideIndex)) {
    throw new Error("Deck currentSlideIndex must be an integer.");
  }
  if (!Array.isArray(state.messages)) {
    throw new Error("Deck messages must be an array.");
  }
  if (typeof state.model !== "string") {
    throw new Error("Deck model must be a string.");
  }
  return state;
}

function enforceMaxBytes(state: DeckState, maxBytes: number) {
  const encoded = new TextEncoder().encode(JSON.stringify(state));
  if (encoded.length > maxBytes) {
    throw new Error("Deck payload exceeds size limit.");
  }
}

function buildRecord(id: string, state: DeckState, createdAt?: string): DeckRecord {
  const timestamp = new Date().toISOString();
  return {
    id,
    state,
    createdAt: createdAt ?? timestamp,
    updatedAt: timestamp,
  };
}

async function readBodyAsString(body: unknown): Promise<string> {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  if (typeof (body as { transformToString?: () => Promise<string> }).transformToString === "function") {
    return (body as { transformToString: () => Promise<string> }).transformToString();
  }
  if (typeof (body as { text?: () => Promise<string> }).text === "function") {
    return (body as { text: () => Promise<string> }).text();
  }
  if (typeof (body as ReadableStream).getReader === "function") {
    const reader = (body as ReadableStream).getReader();
    const decoder = new TextDecoder();
    let result = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) result += decoder.decode(value, { stream: true });
    }
    return result;
  }
  return "";
}

async function parseDeckPayload(raw: string): Promise<DeckRecord | null> {
  try {
    const parsed = JSON.parse(raw) as DeckRecord & { version?: number };
    if (!parsed || parsed.version !== VERSION) return null;
    if (!parsed.id || !parsed.state || !parsed.createdAt || !parsed.updatedAt) return null;
    return {
      id: parsed.id,
      state: parsed.state,
      createdAt: parsed.createdAt,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function createDeckStore(options: DeckStoreOptions = {}): DeckStore {
  const mode = options.mode || "fs";
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  if (mode === "s3") {
    const bucket = options.bucket;
    if (!bucket) {
      throw new Error("Deck S3 bucket is required for s3 mode.");
    }
    const prefix = options.prefix ?? "decks";
    const s3Client = new S3Client({
      region: options.region || "us-east-1",
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
    });

    const keyFor = (id: string) => `${prefix}/${sanitizeId(id)}.json`;

    return {
      async create(state: DeckState) {
        ensureDeckState(state);
        enforceMaxBytes(state, maxBytes);
        const id = crypto.randomUUID();
        const record = buildRecord(id, state);
        const payload = JSON.stringify({ version: VERSION, ...record });
        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: keyFor(id),
            Body: payload,
            ContentType: "application/json",
          })
        );
        return record;
      },
      async get(id: string) {
        const key = keyFor(id);
        try {
          const response = await s3Client.send(
            new GetObjectCommand({
              Bucket: bucket,
              Key: key,
            })
          );
          const raw = await readBodyAsString(response.Body);
          return await parseDeckPayload(raw);
        } catch (error) {
          return null;
        }
      },
      async save(id: string, state: DeckState) {
        ensureDeckState(state);
        enforceMaxBytes(state, maxBytes);
        const key = keyFor(id);
        let createdAt: string | undefined;
        const existing = await this.get(id);
        if (existing) createdAt = existing.createdAt;
        const record = buildRecord(id, state, createdAt);
        const payload = JSON.stringify({ version: VERSION, ...record });
        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: payload,
            ContentType: "application/json",
          })
        );
        return record;
      },
    };
  }

  const dir = options.dir || join(import.meta.dir, "decks");
  const dirReady = mkdir(dir, { recursive: true });

  const pathFor = (id: string) => join(dir, `${sanitizeId(id)}.json`);

  return {
    async create(state: DeckState) {
      await dirReady;
      ensureDeckState(state);
      enforceMaxBytes(state, maxBytes);
      const id = crypto.randomUUID();
      const record = buildRecord(id, state);
      await writeFile(pathFor(id), JSON.stringify({ version: VERSION, ...record }), "utf-8");
      return record;
    },
    async get(id: string) {
      await dirReady;
      try {
        const raw = await readFile(pathFor(id), "utf-8");
        return await parseDeckPayload(raw);
      } catch {
        return null;
      }
    },
    async save(id: string, state: DeckState) {
      await dirReady;
      ensureDeckState(state);
      enforceMaxBytes(state, maxBytes);
      const existing = await this.get(id);
      const record = buildRecord(id, state, existing?.createdAt);
      await writeFile(pathFor(id), JSON.stringify({ version: VERSION, ...record }), "utf-8");
      return record;
    },
  };
}

export function createDefaultDeckStore(): DeckStore {
  const mode = process.env.DECK_STORAGE === "s3" ? "s3" : "fs";
  if (mode === "s3") {
    const bucket = process.env.DECK_S3_BUCKET || process.env.S3_BUCKET;
    if (!bucket) {
      throw new Error("DECK_S3_BUCKET or S3_BUCKET is required for deck storage.");
    }
    return createDeckStore({
      mode: "s3",
      bucket,
      prefix: process.env.DECK_S3_PREFIX || "decks",
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      maxBytes: process.env.MAX_DECK_BYTES ? Number(process.env.MAX_DECK_BYTES) : undefined,
    });
  }

  return createDeckStore({
    mode: "fs",
    dir: process.env.DECK_STORAGE_DIR,
    maxBytes: process.env.MAX_DECK_BYTES ? Number(process.env.MAX_DECK_BYTES) : undefined,
  });
}

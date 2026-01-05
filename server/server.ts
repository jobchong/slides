import { mkdir, unlink } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import {
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { transcribeAudio } from "./groq";
import { generateSlide, generateSlideStream, getDefaultModel, selectModel, parseModelOutput } from "./llm";
import { layoutDiagram } from "./layout";
import { importPptx } from "./import";
import { buildGatewayUrl, buildS3PublicUploadUrl, buildStoredImageUrl } from "./gateway";
import type { ImportOptions } from "./import/types";
import { logError, logInfo, logWarn, preview } from "./logger";
import { createDefaultDeckStore } from "./deck-store";
import { exportDeckToPptx } from "./export";
import { rateLimiter, isRateLimitedEndpoint } from "./rate-limit";
import type { DeckState, Message, Slide } from "../app/src/types";

const port = Number(process.env.PORT || 4000);
const uploadDir = process.env.UPLOAD_DIR || join(import.meta.dir, "uploads");
const maxUploadBytes =
  Number(process.env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024; // 5 MB default
const maxAudioBytes = 25 * 1024 * 1024; // 25 MB for audio (Groq limit)
const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const allowedAudioTypes = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "video/webm", // MediaRecorder sometimes uses video/webm for audio-only
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
]);
const s3Bucket = process.env.S3_BUCKET;
const s3Region = process.env.S3_REGION || "us-east-1";
const s3Endpoint = process.env.S3_ENDPOINT;
const s3ForcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true";
const s3SignedUrlExpires =
  Number(process.env.S3_SIGNED_URL_EXPIRES) || 60 * 60; // 1h default
const devClientUrl = process.env.CLIENT_DEV_URL || "http://localhost:5173";
const isProduction = process.env.NODE_ENV === "production";
const staticDir = join(import.meta.dir, "../app/dist");
const maxDeckBytes = Number(process.env.MAX_DECK_BYTES) || 2 * 1024 * 1024;
const corsAllowlist = new Set([
  "https://slidespell.com",
  "https://www.slidespell.com",
  "http://localhost:5173",
]);

await mkdir(uploadDir, { recursive: true });

const s3Client = s3Bucket
  ? new S3Client({
    region: s3Region,
    endpoint: s3Endpoint,
    forcePathStyle: s3ForcePathStyle,
  })
  : null;

const deckStore = createDefaultDeckStore();

function fileExtension(file: File) {
  const fromName = extname(file.name || "").toLowerCase();
  if (fromName) return fromName;
  const mimeFallback: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
  };
  return mimeFallback[file.type] || "";
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function getCorsOrigin(req: Request): string | null {
  const origin = req.headers.get("Origin");
  if (!origin) return null;
  return corsAllowlist.has(origin) ? origin : null;
}

function applyCors(req: Request, res: Response): Response {
  const origin = getCorsOrigin(req);
  if (!origin) return res;
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  headers.set("Vary", "Origin");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

async function sniffImageType(file: File): Promise<string | null> {
  const header = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    header.length >= 8 &&
    header[0] === 0x89 &&
    header[1] === 0x50 &&
    header[2] === 0x4e &&
    header[3] === 0x47 &&
    header[4] === 0x0d &&
    header[5] === 0x0a &&
    header[6] === 0x1a &&
    header[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    header.length >= 6 &&
    header[0] === 0x47 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x38 &&
    (header[4] === 0x37 || header[4] === 0x39) &&
    header[5] === 0x61
  ) {
    return "image/gif";
  }
  if (
    header.length >= 12 &&
    header[0] === 0x52 &&
    header[1] === 0x49 &&
    header[2] === 0x46 &&
    header[3] === 0x46 &&
    header[8] === 0x57 &&
    header[9] === 0x45 &&
    header[10] === 0x42 &&
    header[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return applyCors(req, new Response(null, { status: 204 }));
  }

  if (req.method === "GET" && url.pathname.startsWith("/images")) {
    return handleImageGet(url);
  }

  const normalizedPath =
    url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;

  if (normalizedPath.startsWith("/api/decks/")) {
    const deckId = normalizedPath.slice("/api/decks/".length);
    if (!deckId) {
      return applyCors(req, jsonResponse({ error: "Deck id is required." }, 400));
    }
    if (req.method === "GET") {
      return applyCors(req, await handleGetDeck(deckId));
    }
    if (req.method === "PUT") {
      return applyCors(req, await handleSaveDeck(req, deckId));
    }
  }
  const routeKey = `${req.method} ${normalizedPath}`;
  const route = routes[routeKey];
  if (route) {
    logInfo("Route hit", { route: routeKey });
    const response = await route(req, url);
    return applyCors(req, response);
  }

  const fallback = fallbackRoute(url, req.method);
  if (fallback) {
    const response = await fallback(req, url);
    return applyCors(req, response);
  }
  return applyCors(req, jsonResponse({ error: "Not found" }, 404));
}

type RouteHandler = (req: Request, url: URL) => Promise<Response> | Response;

const routes: Record<string, RouteHandler> = {
  "GET /health": () => new Response("ok"),
  "POST /api/generate": handleGenerateStream,
  "POST /api/generate/": handleGenerateStream,
  "POST /api/voice-message": handleVoiceMessage,
  "POST /api/voice-message/": handleVoiceMessage,
  "POST /api/import": handleImport,
  "POST /api/import/": handleImport,
  "POST /api/export": handleExport,
  "POST /api/export/": handleExport,
  "POST /api/decks": handleCreateDeck,
  "POST /api/decks/": handleCreateDeck,
  "POST /upload": handleUpload,
  "POST /upload/": handleUpload,
};

async function handleUpload(req: Request): Promise<Response> {
  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    logWarn("Upload missing file field named 'file'.", {
      providedFields: Array.from(form.keys()),
    });
    return jsonResponse({ error: "Missing file field named 'file'." }, 400);
  }

  if (!allowedTypes.has(file.type)) {
    logWarn("Upload rejected due to unsupported type.", {
      type: file.type,
      name: file.name,
    });
    return jsonResponse({ error: `Unsupported type ${file.type}` }, 400);
  }

  const sniffedType = await sniffImageType(file);
  if (!sniffedType || sniffedType !== file.type) {
    logWarn("Upload rejected due to mismatched content type.", {
      type: file.type,
      sniffedType,
      name: file.name,
    });
    return jsonResponse({ error: "File content does not match type." }, 400);
  }

  if (file.size > maxUploadBytes) {
    logWarn("Upload rejected due to size limit.", {
      size: file.size,
      maxUploadBytes,
      name: file.name,
    });
    return jsonResponse({ error: `File too large (max ${maxUploadBytes} bytes)` }, 400);
  }

  logInfo("Upload request accepted", {
    name: file.name,
    type: file.type,
    size: file.size,
    storage: s3Client ? "s3" : "disk",
  });

  const { url: publicUrl, filename } = await saveFile(req, file);
  logInfo("Upload stored successfully", {
    filename,
    publicUrl,
    size: file.size,
    type: file.type,
  });
  return jsonResponse(
    {
      url: publicUrl,
      filename,
      size: file.size,
      type: file.type,
    },
    201
  );
}

function isValidMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as Message;
  return (message.role === "user" || message.role === "assistant") && typeof message.content === "string";
}

function isValidSlide(value: unknown): value is Slide {
  if (!value || typeof value !== "object") return false;
  const slide = value as Slide;
  return typeof slide.id === "string" && typeof slide.html === "string";
}

function parseDeckState(value: unknown): DeckState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as DeckState;
  if (!Array.isArray(state.slides) || state.slides.length === 0) return null;
  if (!state.slides.every(isValidSlide)) return null;
  if (!Number.isInteger(state.currentSlideIndex)) return null;
  if (!Array.isArray(state.messages) || !state.messages.every(isValidMessage)) return null;
  if (typeof state.model !== "string") return null;
  return state;
}

function isValidDeckId(deckId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(deckId);
}

async function readDeckStateFromRequest(req: Request): Promise<DeckState> {
  const raw = await req.text();
  const bytes = new TextEncoder().encode(raw);
  if (bytes.length > maxDeckBytes) {
    throw new Error("Deck payload exceeds size limit.");
  }
  const parsed = JSON.parse(raw) as { state?: DeckState };
  const state = parseDeckState(parsed?.state);
  if (!state) {
    throw new Error("Invalid deck payload.");
  }
  return state;
}

async function handleCreateDeck(req: Request): Promise<Response> {
  try {
    const state = await readDeckStateFromRequest(req);
    const record = await deckStore.create(state);
    return jsonResponse(record, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create deck.";
    return jsonResponse({ error: message }, 400);
  }
}

async function handleGetDeck(deckId: string): Promise<Response> {
  if (!isValidDeckId(deckId)) {
    return jsonResponse({ error: "Invalid deck id." }, 400);
  }
  const deck = await deckStore.get(deckId);
  if (!deck) {
    return jsonResponse({ error: "Deck not found." }, 404);
  }
  return jsonResponse(deck);
}

async function handleSaveDeck(req: Request, deckId: string): Promise<Response> {
  if (!isValidDeckId(deckId)) {
    return jsonResponse({ error: "Invalid deck id." }, 400);
  }
  try {
    const state = await readDeckStateFromRequest(req);
    const record = await deckStore.save(deckId, state);
    return jsonResponse(record);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save deck.";
    return jsonResponse({ error: message }, 400);
  }
}

async function handleExport(req: Request): Promise<Response> {
  try {
    const payload = await req.json();
    if (!payload || !Array.isArray(payload.slides)) {
      return jsonResponse({ error: "Slides payload is required." }, 400);
    }

    const slides = payload.slides.filter((slide: Slide) => slide && typeof slide.html === "string");
    if (slides.length === 0) {
      return jsonResponse({ error: "No slides to export." }, 400);
    }

    const baseUrl = new URL(req.url).origin;
    const pptx = await exportDeckToPptx(slides, baseUrl);
    return new Response(pptx, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": "attachment; filename=\"slides.pptx\"",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to export slides.";
    return jsonResponse({ error: message }, 500);
  }
}

async function handleGenerateStream(req: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await req.json();
    const { messages, currentHtml = "", model } = body || {};

    if (!Array.isArray(messages) || !messages.every(isValidMessage)) {
      logWarn("Generate stream request rejected: messages invalid.", {
        receivedType: typeof messages,
      });
      return jsonResponse({ error: "messages must be an array of role/content objects" }, 400);
    }

    const lastMessage = messages[messages.length - 1]?.content || "";
    const selectedModel = selectModel(lastMessage, model);

    logInfo("Generate stream request received", {
      model: selectedModel,
      messagesCount: messages.length,
      lastMessagePreview: preview(messages[messages.length - 1]?.content),
      currentHtmlLength: currentHtml.length,
    });

    const encoder = new TextEncoder();
    let totalLength = 0;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Accumulate response to detect diagrams
          let accumulated = "";

          for await (const chunk of generateSlideStream(
            messages,
            currentHtml,
            selectedModel
          )) {
            accumulated += chunk;
            totalLength += chunk.length;

            // Stream chunks for non-diagram content (for responsive UI)
            // If it looks like a diagram is starting, buffer everything
            // Check for partial tag "<diagram" (without closing >) to catch early
            if (!accumulated.includes("<diagram")) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
            }
          }

          // After streaming completes, check if it's a diagram
          const parsed = parseModelOutput(accumulated);

          if (parsed.type === "diagram") {
            // Process diagram through layout engine
            const { html } = layoutDiagram(parsed.intent);
            logInfo("Diagram processed", {
              nodeCount: parsed.intent.nodes.length,
              layout: parsed.intent.layout.type,
            });
            // Send the rendered HTML as a single chunk
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(html)}\n\n`));
          } else if (accumulated.includes("<diagram>")) {
            // We buffered diagram content but parsing failed - send raw
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(accumulated)}\n\n`));
          }
          // For non-diagram content, chunks were already sent

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();

          const durationMs = Date.now() - start;
          logInfo("Generate stream completed", {
            model: selectedModel,
            totalLength,
            durationMs,
            outputType: parsed.type,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: errorMessage })}\n\n`)
          );
          controller.close();
          logError("Generate stream failed mid-stream.", {
            error: errorMessage,
            durationMs: Date.now() - start,
          });
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    logError("Generate stream handler failed.", {
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs: Date.now() - start,
    });
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
}

async function handleVoiceMessage(req: Request): Promise<Response> {
  let generationStart: number | null = null;
  try {
    const form = await req.formData();
    const audioFile = form.get("audio");
    const messagesJson = form.get("messages");
    const currentHtml = (form.get("currentHtml") as string) || "";
    const userModel = form.get("model") as string | null;

    if (!(audioFile instanceof File)) {
      logWarn("Voice message rejected: missing audio file.", {
        providedFields: Array.from(form.keys()),
      });
      return jsonResponse({ error: "Missing audio file field named 'audio'." }, 400);
    }

    logInfo("Voice message received", {
      type: audioFile.type,
      size: audioFile.size,
      name: audioFile.name,
    });

    if (!allowedAudioTypes.has(audioFile.type)) {
      logWarn("Voice message rejected due to unsupported audio type.", {
        type: audioFile.type,
        allowedTypes: Array.from(allowedAudioTypes),
      });
      return jsonResponse({ error: `Unsupported audio type ${audioFile.type}. Allowed types: ${Array.from(allowedAudioTypes).join(", ")}` }, 400);
    }

    if (audioFile.size > maxAudioBytes) {
      logWarn("Voice message rejected due to audio size limit.", {
        size: audioFile.size,
        maxAudioBytes,
      });
      return jsonResponse({ error: `Audio file too large (max ${maxAudioBytes} bytes)` }, 400);
    }

    if (!messagesJson || typeof messagesJson !== "string") {
      logWarn("Voice message rejected: missing or invalid messages field.", {
        messagesType: typeof messagesJson,
      });
      return jsonResponse({ error: "Missing or invalid messages field." }, 400);
    }

    let messages;
    try {
      messages = JSON.parse(messagesJson);
    } catch (e) {
      logWarn("Voice message rejected: invalid JSON in messages field.", {
        parseError: e instanceof Error ? e.message : "Unknown error",
      });
      return jsonResponse({ error: "Invalid JSON in messages field." }, 400);
    }

    if (!Array.isArray(messages) || !messages.every(isValidMessage)) {
      logWarn("Voice message rejected: messages field invalid.", {
        messagesType: typeof messages,
      });
      return jsonResponse({ error: "Invalid messages field." }, 400);
    }

    logInfo("Voice transcription requested", {
      messagesCount: Array.isArray(messages) ? messages.length : 0,
      lastMessagePreview: Array.isArray(messages)
        ? preview(messages[messages.length - 1]?.content)
        : undefined,
    });

    // Transcribe audio with Groq Whisper
    const transcription = await transcribeAudio(audioFile);

    if (!transcription) {
      logWarn("Voice transcription returned empty result.");
      return jsonResponse({ error: "Failed to transcribe audio." }, 500);
    }

    // Select model based on transcription content
    const selectedModel = selectModel(transcription, userModel || undefined);

    // Add transcription as a user message
    const updatedMessages = [
      ...messages,
      { role: "user", content: transcription },
    ];

    // Generate slide with the selected model
    generationStart = Date.now();
    const slideHtml = await generateSlide(updatedMessages, currentHtml, selectedModel);
    const durationMs = Date.now() - generationStart;

    logInfo("Voice message response produced", {
      model: selectedModel,
      transcription: preview(transcription),
      htmlLength: slideHtml?.length ?? 0,
      htmlPreview: preview(slideHtml),
      durationMs,
    });

    return jsonResponse({
      html: slideHtml,
      transcription,
    });
  } catch (error) {
    logError("Voice message handler failed.", {
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs: generationStart ? Date.now() - generationStart : undefined,
    });
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
}

const maxPptxBytes = 50 * 1024 * 1024; // 50 MB for PPTX files

async function handleImport(req: Request): Promise<Response> {
  const start = Date.now();
  let tempPptxPath: string | null = null;

  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      logWarn("Import missing file field", {
        providedFields: Array.from(form.keys()),
      });
      return jsonResponse({ error: "Missing file field named 'file'." }, 400);
    }

    if (!file.name.toLowerCase().endsWith(".pptx")) {
      logWarn("Import rejected: not a PPTX file", { name: file.name });
      return jsonResponse({ error: "Only .pptx files are supported." }, 400);
    }

    if (file.size > maxPptxBytes) {
      logWarn("Import rejected due to size limit", {
        size: file.size,
        maxPptxBytes,
        name: file.name,
      });
      return jsonResponse({ error: `File too large (max ${maxPptxBytes / 1024 / 1024} MB)` }, 400);
    }

    logInfo("Import request accepted", {
      name: file.name,
      size: file.size,
    });

    // Save PPTX to temp file
    const tempDir = join(uploadDir, "temp");
    await mkdir(tempDir, { recursive: true });
    tempPptxPath = join(tempDir, `${Date.now()}-${crypto.randomUUID()}.pptx`);
    await Bun.write(tempPptxPath, file);

    const encoder = new TextEncoder();
    const importOptions: ImportOptions = { concurrency: 8 };

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const progress of importPptx(tempPptxPath!, tempDir, req, importOptions)) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(progress)}\n\n`)
            );
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();

          logInfo("Import completed", {
            name: file.name,
            durationMs: Date.now() - start,
          });
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : "Unknown error";
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: "error", error: errorMessage })}\n\n`)
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
          logError("Import failed mid-stream", {
            error: errorMessage,
            durationMs: Date.now() - start,
          });
        } finally {
          // Clean up temp PPTX file
          if (tempPptxPath) {
            try {
              if (await Bun.file(tempPptxPath).exists()) {
                await unlink(tempPptxPath);
              }
            } catch {
              // Ignore cleanup errors
            }
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    logError("Import handler failed", {
      error: error instanceof Error ? error.message : "Unknown error",
      durationMs: Date.now() - start,
    });
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
}

async function handleImageGet(url: URL): Promise<Response> {
  const filename = url.pathname.replace(/^\/images\/?/, "");
  if (!filename) {
    return jsonResponse({ error: "No filename provided" }, 400);
  }
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return jsonResponse({ error: "Invalid filename" }, 400);
  }

  if (s3Client) {
    const directPublicUrl = buildS3PublicUploadUrl(filename);
    if (directPublicUrl) {
      return new Response(null, {
        status: 302,
        headers: { Location: directPublicUrl },
      });
    }

    const key = `uploads/${filename}`;
    const command = new GetObjectCommand({ Bucket: s3Bucket, Key: key });
    const publicUrl = await getSignedUrl(s3Client, command, {
      expiresIn: s3SignedUrlExpires,
    });
    return new Response(null, {
      status: 302,
      headers: { Location: publicUrl },
    });
  }

  const diskPath = normalize(join(uploadDir, filename));
  if (!diskPath.startsWith(normalize(uploadDir + "/"))) {
    return jsonResponse({ error: "Invalid path" }, 400);
  }

  const file = Bun.file(diskPath);
  if (!(await file.exists())) {
    return jsonResponse({ error: "Not found" }, 404);
  }

  return new Response(file, {
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
}

function fallbackRoute(url: URL, method: string): RouteHandler | null {
  if (method !== "GET") return null;

  // Production: serve static files from app/dist
  if (isProduction) {
    return async () => {
      let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
      const fullPath = normalize(join(staticDir, filePath));

      // Security: prevent path traversal
      if (!fullPath.startsWith(normalize(staticDir + "/"))) {
        return jsonResponse({ error: "Invalid path" }, 400);
      }

      const file = Bun.file(fullPath);
      if (await file.exists()) {
        const mimeTypes: Record<string, string> = {
          ".html": "text/html",
          ".js": "application/javascript",
          ".css": "text/css",
          ".json": "application/json",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".svg": "image/svg+xml",
          ".ico": "image/x-icon",
          ".woff": "font/woff",
          ".woff2": "font/woff2",
        };
        const ext = extname(filePath);
        const contentType = mimeTypes[ext] || "application/octet-stream";
        return new Response(file, {
          headers: { "Content-Type": contentType },
        });
      }

      // SPA fallback: serve index.html for unmatched routes
      const indexPath = join(staticDir, "index.html");
      const indexFile = Bun.file(indexPath);
      if (await indexFile.exists()) {
        return new Response(indexFile, {
          headers: { "Content-Type": "text/html" },
        });
      }

      return jsonResponse({ error: "Not found" }, 404);
    };
  }

  // Development: proxy to Vite dev server
  return async () => {
    const target = `${devClientUrl}${url.pathname}${url.search}`;
    const proxied = await fetch(target);
    return new Response(proxied.body, {
      status: proxied.status,
      headers: proxied.headers,
    });
  };
}

async function saveFile(
  req: Request,
  file: File
): Promise<{ url: string; filename: string }> {
  const extension = fileExtension(file);
  const filename = `${Date.now()}-${crypto.randomUUID()}${extension}`;

  if (s3Client) {
    const key = `uploads/${filename}`;
    const body = new Uint8Array(await file.arrayBuffer());
    await s3Client.send(
      new PutObjectCommand({
        Bucket: s3Bucket,
        Key: key,
        Body: body,
        ContentType: file.type || "application/octet-stream",
      })
    );
    // Prefer direct S3/CDN URL if configured; otherwise return a stable gateway URL.
    return { url: buildStoredImageUrl(req, filename), filename };
  }

  const targetPath = join(uploadDir, filename);
  await Bun.write(targetPath, file);
  return { url: buildGatewayUrl(req, filename), filename };
}

const server = Bun.serve({
  port,
  idleTimeout: 255,
  async fetch(req, server) {
    const url = new URL(req.url);
    const clientIP = server.requestIP(req);

    // Rate limit check for expensive endpoints
    if (isRateLimitedEndpoint(req.method, url.pathname)) {
      const result = await rateLimiter.check(req, clientIP);
      if (!result.allowed) {
        const response = jsonResponse(
          {
            error: result.error || "Rate limit exceeded",
            remaining: result.remaining,
            resetAt: result.resetAt,
          },
          429
        );
        return applyCors(req, response);
      }
      // Increment counter for allowed requests
      await rateLimiter.increment(req, clientIP);
    }

    return handleRequest(req);
  },
  error(error) {
    logError("Unhandled server error:", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log(`Model service listening on ${server.url}`);

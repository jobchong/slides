import { mkdir } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import {
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { transcribeAudio } from "./groq";
import { generateSlide, generateSlideStream, getDefaultModel } from "./llm";
import { importPptx } from "./import";
import { buildGatewayUrl, buildS3PublicUploadUrl, buildStoredImageUrl } from "./gateway";
import type { ImportOptions } from "./import/types";
import { logError, logInfo, logWarn, preview } from "./logger";

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
const enableDevProxy = process.env.NODE_ENV !== "production";
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

async function handleGenerateStream(req: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await req.json();
    const { messages, currentHtml = "", model } = body || {};

    if (!Array.isArray(messages)) {
      logWarn("Generate stream request rejected: messages must be an array.", {
        receivedType: typeof messages,
      });
      return jsonResponse({ error: "messages must be an array" }, 400);
    }

    const selectedModel =
      model ||
      process.env.DEFAULT_MODEL ||
      process.env.VITE_DEFAULT_MODEL ||
      getDefaultModel();

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
          for await (const chunk of generateSlideStream(
            messages,
            currentHtml,
            selectedModel
          )) {
            totalLength += chunk.length;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();

          const durationMs = Date.now() - start;
          logInfo("Generate stream completed", {
            model: selectedModel,
            totalLength,
            durationMs,
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
    const selectedModel =
      (form.get("model") as string | null) ||
      process.env.DEFAULT_MODEL ||
      process.env.VITE_DEFAULT_MODEL ||
      getDefaultModel();

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
      model: selectedModel,
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
              await Bun.file(tempPptxPath).exists() &&
                (await import("node:fs/promises")).unlink(tempPptxPath);
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
  if (method !== "GET" || !enableDevProxy) return null;
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
  async fetch(req) {
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

import { mkdir } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import {
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { transcribeAudio } from "./groq";
import { generateSlide, getDefaultModel } from "./llm";

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

function buildGatewayUrl(req: Request, filename: string) {
  const base =
    process.env.PUBLIC_BASE_URL ||
    `${req.headers.get("x-forwarded-proto") || "http"}://${req.headers.get("host") || `localhost:${port}`}`;
  return `${base}/images/${filename}`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  if (req.method === "GET" && url.pathname.startsWith("/images")) {
    return handleImageGet(url);
  }

  const normalizedPath =
    url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const routeKey = `${req.method} ${normalizedPath}`;
  const route = routes[routeKey] || fallbackRoute(url, req.method);
  if (route) return route(req, url);
  return jsonResponse({ error: "Not found" }, 404);
}

type RouteHandler = (req: Request, url: URL) => Promise<Response> | Response;

const routes: Record<string, RouteHandler> = {
  "GET /health": () => new Response("ok"),
  "POST /api/generate": handleGenerate,
  "POST /api/generate/": handleGenerate,
  "POST /api/voice-message": handleVoiceMessage,
  "POST /api/voice-message/": handleVoiceMessage,
  "POST /upload": handleUpload,
  "POST /upload/": handleUpload,
};

async function handleUpload(req: Request): Promise<Response> {
  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return jsonResponse({ error: "Missing file field named 'file'." }, 400);
  }

  if (!allowedTypes.has(file.type)) {
    return jsonResponse({ error: `Unsupported type ${file.type}` }, 400);
  }

  if (file.size > maxUploadBytes) {
    return jsonResponse({ error: `File too large (max ${maxUploadBytes} bytes)` }, 400);
  }

  const { url: publicUrl, filename } = await saveFile(req, file);
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

async function handleGenerate(req: Request): Promise<Response> {
  try {
    const body = await req.json();
    const { messages, currentHtml = "", model } = body || {};

    if (!Array.isArray(messages)) {
      return jsonResponse({ error: "messages must be an array" }, 400);
    }

    const selectedModel =
      model ||
      process.env.DEFAULT_MODEL ||
      process.env.VITE_DEFAULT_MODEL ||
      getDefaultModel();

    const html = await generateSlide(messages, currentHtml, selectedModel);
    return jsonResponse({ html });
  } catch (error) {
    console.error("Generate error:", error);
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500
    );
  }
}

async function handleVoiceMessage(req: Request): Promise<Response> {
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
      return jsonResponse({ error: "Missing audio file field named 'audio'." }, 400);
    }

    console.log(`Received audio: ${audioFile.type} (${audioFile.size} bytes, name: ${audioFile.name})`);

    if (!allowedAudioTypes.has(audioFile.type)) {
      return jsonResponse({ error: `Unsupported audio type ${audioFile.type}. Allowed types: ${Array.from(allowedAudioTypes).join(", ")}` }, 400);
    }

    if (audioFile.size > maxAudioBytes) {
      return jsonResponse({ error: `Audio file too large (max ${maxAudioBytes} bytes)` }, 400);
    }

    if (!messagesJson || typeof messagesJson !== "string") {
      return jsonResponse({ error: "Missing or invalid messages field." }, 400);
    }

    let messages;
    try {
      messages = JSON.parse(messagesJson);
    } catch (e) {
      return jsonResponse({ error: "Invalid JSON in messages field." }, 400);
    }

    // Transcribe audio with Groq Whisper
    const transcription = await transcribeAudio(audioFile);

    if (!transcription) {
      return jsonResponse({ error: "Failed to transcribe audio." }, 500);
    }

    // Add transcription as a user message
    const updatedMessages = [
      ...messages,
      { role: "user", content: transcription },
    ];

    // Generate slide with the selected model
    const slideHtml = await generateSlide(updatedMessages, currentHtml, selectedModel);

    return jsonResponse({
      html: slideHtml,
      transcription,
    });
  } catch (error) {
    console.error("Voice message error:", error);
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
    // Return a stable gateway URL; GET handler issues fresh signed URLs per request.
    const gatewayUrl = buildGatewayUrl(req, filename);
    return { url: gatewayUrl, filename };
  }

  const targetPath = join(uploadDir, filename);
  await Bun.write(targetPath, file);
  const publicUrl = buildGatewayUrl(req, filename);
  return { url: publicUrl, filename };
}

const server = Bun.serve({
  port,
  async fetch(req) {
    return handleRequest(req);
  },
  error(error) {
    console.error("Unhandled server error:", error);
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log(`Image service listening on ${server.url}`);

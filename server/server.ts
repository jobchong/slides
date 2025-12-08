import { mkdir } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import {
  PutObjectCommand,
  S3Client,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const port = Number(process.env.PORT || 4000);
const uploadDir = process.env.UPLOAD_DIR || join(import.meta.dir, "uploads");
const maxUploadBytes =
  Number(process.env.MAX_UPLOAD_BYTES) || 5 * 1024 * 1024; // 5 MB default
const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const s3Bucket = process.env.S3_BUCKET;
const s3Region = process.env.S3_REGION || "us-east-1";
const s3Endpoint = process.env.S3_ENDPOINT;
const s3ForcePathStyle = process.env.S3_FORCE_PATH_STYLE === "true";
const s3SignedUrlExpires =
  Number(process.env.S3_SIGNED_URL_EXPIRES) || 60 * 60; // 1h default
const corsOrigin = process.env.CORS_ORIGIN || "*";

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

function withCors(res: Response) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", corsOrigin);
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Expose-Headers", "Content-Type");
  return new Response(res.body, { status: res.status, headers });
}

async function saveFile(
  req: Request,
  file: File
): Promise<{ url: string; filename: string }> {
  const extension = fileExtension(file);
  const filename = `${Date.now()}-${crypto.randomUUID()}${extension}`;

  if (s3Client) {
    const key = `uploads/${filename}`;
    const body = await file.arrayBuffer();
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
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return withCors(
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": corsOrigin,
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        })
      );
    }

    if (url.pathname === "/health") {
      return withCors(new Response("ok"));
    }

    if (url.pathname === "/upload" && req.method === "POST") {
      const form = await req.formData();
      const file = form.get("file");

      if (!(file instanceof File)) {
        return withCors(jsonResponse({ error: "Missing file field named 'file'." }, 400));
      }

      if (!allowedTypes.has(file.type)) {
        return withCors(jsonResponse({ error: `Unsupported type ${file.type}` }, 400));
      }

      if (file.size > maxUploadBytes) {
        return withCors(
          jsonResponse({ error: `File too large (max ${maxUploadBytes} bytes)` }, 400)
        );
      }

      const { url: publicUrl, filename } = await saveFile(req, file);
      return withCors(
        jsonResponse(
          {
            url: publicUrl,
            filename,
            size: file.size,
            type: file.type,
          },
          201
        )
      );
    }

    if (url.pathname.startsWith("/images/") && req.method === "GET") {
      const filename = url.pathname.replace("/images/", "");
      if (!filename) {
        return withCors(jsonResponse({ error: "No filename provided" }, 400));
      }
      if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
        return withCors(jsonResponse({ error: "Invalid filename" }, 400));
      }

      if (s3Client) {
        const key = `uploads/${filename}`;
        const command = new GetObjectCommand({ Bucket: s3Bucket, Key: key });
        const publicUrl = await getSignedUrl(s3Client, command, {
          expiresIn: s3SignedUrlExpires,
        });
        return withCors(
          new Response(null, {
            status: 302,
            headers: { Location: publicUrl },
          })
        );
      }

      const diskPath = normalize(join(uploadDir, filename));
      if (!diskPath.startsWith(normalize(uploadDir + "/"))) {
        return withCors(jsonResponse({ error: "Invalid path" }, 400));
      }

      const file = Bun.file(diskPath);
      if (!(await file.exists())) {
        return withCors(jsonResponse({ error: "Not found" }, 404));
      }

      return withCors(
        new Response(file, {
          headers: { "Content-Type": file.type || "application/octet-stream" },
        })
      );
    }

    return withCors(jsonResponse({ error: "Not found" }, 404));
  },
});

console.log(`Image service listening on ${server.url}`);

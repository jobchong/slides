# Image Upload Service (Bun)

Basic file host that matches the image-upload/retrieval plan in `app/design.md`. It accepts images, stores them locally, and hands back a public URL you can pass into the slide chat flow.

## Prerequisites
- [Bun](https://bun.sh/) installed (tested with Bun 1.1+).

## Run it
```sh
bun install           # from repo root, pulls client + server deps
bun run dev:server
# or directly:
# bun run server/server.ts
```

Configurable env vars:
- `PORT` (default `4000`)
- `UPLOAD_DIR` (default `<repo>/server/uploads`)
- `PUBLIC_BASE_URL` (overrides host detection when running behind a proxy)
- `MAX_UPLOAD_BYTES` (default `5242880` ≈ 5MB)
- `S3_BUCKET` (enable S3 storage when set; otherwise uses local disk)
- `S3_REGION` (defaults to `us-east-1`)
- `S3_ENDPOINT` (optional, for MinIO/Localstack/custom endpoints)
- `S3_FORCE_PATH_STYLE` (set `true` for path-style endpoints)
- `S3_SIGNED_URL_EXPIRES` (seconds for GET presigns; default `3600`)
- `CORS_ORIGIN` (default `*`; set to your frontend origin like `http://localhost:5173`)

## Endpoints
- `POST /upload` — multipart form with `file` field (jpg/png/webp/gif). Validates type and size, stores either on disk (`UPLOAD_DIR`) or S3 (`S3_BUCKET`), returns JSON `{ url, filename, size, type }`. The `url` is a stable `/images/<filename>` gateway you can hand to the LLM without exposing S3.
- `GET /images/:filename` — disk mode: serves the binary; S3 mode: 302 redirect to a short-lived presigned URL on every request (no bucket public access required).
- `GET /health` — simple liveness probe.

## Example usage
```sh
# Upload an image
curl -F "file=@/path/to/picture.png" http://localhost:4000/upload

# Retrieve it (replace <filename> from the upload response)
curl -O http://localhost:4000/images/<filename>
```

Wire the returned `url` into the front-end by adding a chat note like `Uploaded image available at: <url>` before asking the LLM to place it on the slide (per the design doc).

# Slide AI (Monolith)

Single repo with the chat-driven slide builder and the image upload service under Bun.

## Layout
- `app/`: Vite + React UI. See `app/design.md` for architecture and the LLM contract.
- `server/`: Bun upload host (disk by default, S3-ready) returning public URLs for the UI.
- `app/design.md`: Source of truth for state, prompting, rendering, and the upload flow.

## Run
```sh
bun install
VITE_ANTHROPIC_API_KEY=... VITE_UPLOAD_API_URL=http://localhost:4000 bun run dev
# or separately:
# bun run dev:server
# VITE_ANTHROPIC_API_KEY=... VITE_UPLOAD_API_URL=http://localhost:4000 bun run dev:client
```

Server env toggles:
- `PORT` (default `4000`)
- `UPLOAD_DIR` (default `<repo>/server/uploads`)
- `PUBLIC_BASE_URL` (override host/proto when behind a proxy)
- `MAX_UPLOAD_BYTES` (default `5MB`)
- `S3_BUCKET` (enables S3 storage when set)
- `S3_REGION` (default `us-east-1`)
- `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE` (for MinIO/Localstack/custom endpoints)
- `S3_SIGNED_URL_EXPIRES` (seconds for presigned GETs; default `3600`)

Frontend env:
- `VITE_ANTHROPIC_API_KEY` (required)
- `VITE_UPLOAD_API_URL` (image service base, default `http://localhost:4000`)

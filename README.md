# Slide AI (Monolith)

Single repo with the chat-driven slide builder and the Bun-based model service (uploads + LLM + voice).

## Layout
- `app/`: Vite + React UI. See `app/design.md` for architecture and the LLM contract.
- `server/`: Bun model service (uploads, LLM, voice, PPTX import) returning public URLs for the UI.
- `app/design.md`: Source of truth for state, prompting, rendering, and the upload flow.
- `docs/`: Supporting specs (multi-slide management, speech input).

## Run
```sh
bun install
VITE_MODEL_API_KEY=... VITE_MODEL_SERVICE_URL=http://localhost:4000 bun run dev
# or separately:
# bun run dev:server   # bun --watch server/server.ts (auto-reloads on changes)
# VITE_MODEL_API_KEY=... VITE_MODEL_SERVICE_URL=http://localhost:4000 bun run dev:client

Note: the server currently proxies the client and API from `http://localhost:4000` to avoid CORS preflights from `localhost:5173`. Open the app on `http://localhost:4000` while the CORS headers are being restored.
```

## PPTX Import

Import existing PowerPoint presentations to edit with AI. Click "Import PPTX" in the thumbnail panel to upload a `.pptx` file.

### How it works
This repo uses a high-fidelity import strategy that combines deterministic parsing with an LLM vision step:

1. LibreOffice converts PPTX → PDF
2. Poppler (`pdftoppm`) converts PDF pages → PNG images (one per slide)
3. The server parses slide OOXML (positions, text, images, theme) to build structured element data
4. A vision-capable model converts the screenshot + structured element data into editable HTML per slide
5. Slides stream into the app as they're converted (SSE)

### Requirements

The server needs LibreOffice, Poppler, and `unzip` installed:

**macOS:**
```sh
brew install --cask libreoffice
brew install poppler
```

**Ubuntu/Debian:**
```sh
sudo apt install libreoffice-nogui poppler-utils unzip
```

**Docker:** See Dockerfile for installation commands.

Server env toggles:
- `PORT` (default `4000`)
- `UPLOAD_DIR` (default `<repo>/server/uploads`)
- `PUBLIC_BASE_URL` (override host/proto when behind a proxy)
- `MAX_UPLOAD_BYTES` (default `5MB`)
- `S3_PUBLIC_BASE_URL` (if set, uploads return direct S3/CDN URLs instead of `/images/{filename}` redirects)
- `S3_BUCKET` (enables S3 storage when set)
- `S3_REGION` (default `us-east-1`)
- `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE` (for MinIO/Localstack/custom endpoints)
- `S3_SIGNED_URL_EXPIRES` (seconds for presigned GETs; default `3600`)
- `MODEL_API_KEY` (generic key for the selected model; falls back to `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`)
- `DEFAULT_MODEL` (defaults to `claude-3.5-sonnet-20241022` if omitted)
 - PPTX import concurrency is currently fixed at `8` on the server (not user-configurable)

Frontend env:
- `VITE_MODEL_API_KEY` (preferred; falls back to `VITE_ANTHROPIC_API_KEY` or `VITE_OPENAI_API_KEY`)
- `VITE_MODEL_SERVICE_URL` (model service base, default `http://localhost:4000`)
- `VITE_UPLOAD_API_URL` (deprecated alias for the model service base; fallback support remains)
- `VITE_SERVER_URL` (voice endpoint base, default `http://localhost:4000`)
- `VITE_DEFAULT_MODEL` (optional override for initial model in the picker)

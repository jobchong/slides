# Slide AI Documentation

Single source of truth for product context, architecture, setup, and feature specs.

## Product Overview
Slide AI is a chat-driven slide builder. Users describe slides in chat; a model returns raw HTML that renders directly in the browser. The system supports multi-slide editing, image uploads, PPTX import, and voice input.

## Repo Layout
- `app/`: Vite + React frontend
- `server/`: Bun model service (uploads, LLM, voice, PPTX import)
- `docs/`: Specs and long-form docs
- `ppts/`: Sample PPTX files for import testing

## Quick Start
```sh
bun install
VITE_MODEL_API_KEY=... VITE_MODEL_SERVICE_URL=http://localhost:4000 bun run dev
```

Run client/server separately:
```sh
bun run dev:server
VITE_MODEL_API_KEY=... VITE_MODEL_SERVICE_URL=http://localhost:4000 bun run dev:client
```

Note: the server currently proxies client + API from `http://localhost:4000` to avoid CORS preflights from `localhost:5173`.

## Commands
- `bun run dev`
- `bun run dev:server`
- `bun run dev:client`
- `bun run typecheck:client`
- `bun run typecheck:server`

## Environment Variables
Frontend (prefix `VITE_`):
- `VITE_MODEL_API_KEY` (preferred; falls back to `VITE_ANTHROPIC_API_KEY` / `VITE_OPENAI_API_KEY`)
- `VITE_MODEL_SERVICE_URL` (default `http://localhost:4000`)
- `VITE_UPLOAD_API_URL` (deprecated alias)
- `VITE_SERVER_URL` (voice endpoint base)
- `VITE_DEFAULT_MODEL` (optional initial model override)

Backend:
- `PORT` (default `4000`)
- `MODEL_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY`
- `GROQ_API_KEY` (voice transcription)
- `UPLOAD_DIR` (default `server/uploads`)
- `MAX_UPLOAD_BYTES` (default `5MB`)
- `PUBLIC_BASE_URL` (proxy/host override)
- `S3_BUCKET` (enable S3 storage)
- `S3_PUBLIC_BASE_URL` (direct CDN/S3 URLs)
- `S3_REGION` (default `us-east-1`)
- `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE`
- `S3_SIGNED_URL_EXPIRES` (seconds; default `3600`)

## Architecture Summary
- **State**: `slides[]`, `currentSlideIndex`, `messages[]`, `model`, `isLoading` live in `app/src/App.tsx`.
- **Rendering**: Slides are raw HTML rendered into `.slide` via `dangerouslySetInnerHTML`.
- **LLM contract**: The model returns complete slide HTML (no markdown). Absolute positioning with percent-based layout; `px` for font sizes; `<img>` tags for images.
- **Message shaping**: The latest user message includes `Current slide HTML` before the request to keep edits stateful.

## PPTX Import
Import converts PPTX into editable HTML using deterministic parsing (no LLM calls).

Pipeline:
1. Server unzips PPTX contents
2. Parse OOXML (text, shapes, images, theme)
3. Upload embedded images and resolve URLs
4. Render editable HTML per slide
5. Slides stream to the client (SSE)

Requirements:
- `unzip` available on the server

Notes:
- PPTX import concurrency is fixed at `8` on the server.
- `S3_PUBLIC_BASE_URL` enables direct S3/CDN URLs in generated HTML.
- Template extraction: masters/layouts are parsed and merged so template visuals appear in the import output.
- Manual test helper `server/import/pptx-to-html.ts` now renders master/layout previews after slides for visual validation.

## Frontend Rendering
- UI currently renders server-provided HTML while still retaining structured `SlideSource` data for future editing.

## Multi-Slide Management
- Slides are `{ id, html, thumbnail? }` stored in an array.
- Thumbnail sidebar supports navigation, add/delete, and keyboard shortcuts.
- Navigation keys: arrows, Home/End, `Cmd/Ctrl + M`, Delete/Backspace.

## Speech Input
- Uses Groq Whisper API server-side for transcription.
- UI stays in the chat input area with a recording indicator and timer.
- Flow: record → upload → transcribe → generate slide → return HTML.

## Deployment (Cloudflare Pages + AWS App Runner)
Minimal deployment uses Cloudflare Pages for the frontend and AWS App Runner for the backend.

Backend (App Runner):
- Use the repo `Dockerfile` and expose port `4000`.
- Set env vars: `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, plus any storage vars (`S3_BUCKET`, etc.).

Frontend (Cloudflare Pages):
- Build command: `bun run build:client`
- Output: `app/dist`
- Set `VITE_MODEL_SERVICE_URL` to the App Runner URL.

Server CORS:
- Add your production domain to `server/server.ts` allowed origins.

Optional S3:
- Set `S3_BUCKET` and `S3_PUBLIC_BASE_URL` for direct CDN/S3 URLs.

## Testing
- `bun test` runs unit tests (import parsing/rendering).
- PPTX import tests use `/ppts` fixtures to validate deterministic output.

## Further Reading
- `app/design.md` for detailed architecture and LLM contract
- `docs/slides.md` for multi-slide UI spec
- `docs/speech.md` for voice UX and API design
- `deployment.md` for the detailed deployment plan

# Slide AI Bun Server

The Bun service handles:
- slide generation and streaming
- voice transcription + generation
- image uploads
- deck persistence
- PPTX import
- PPTX export
- frontend proxying in development and static serving in production

## Quick Start

```sh
bun install
ANTHROPIC_API_KEY=... bun run dev:server
```

By default the server listens on `http://localhost:4000`.

## Prerequisites

- Bun 1.1+
- `unzip` for PPTX import

Optional tooling:
- Chrome or Chromium for export rasterization and visual preview helpers
- LibreOffice or `soffice`, `pdftoppm`, and ImageMagick for `preview:pptx:visual`

## Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness probe |
| `POST` | `/api/generate` | SSE slide generation |
| `POST` | `/api/voice-message` | Multipart audio transcription + generation |
| `POST` | `/api/import` | SSE PPTX import |
| `POST` | `/api/export` | Export deck to `.pptx` |
| `POST` | `/api/decks` | Create remote deck |
| `GET` | `/api/decks/:id` | Load remote deck |
| `PUT` | `/api/decks/:id` | Save remote deck |
| `POST` | `/upload` | Multipart image upload |
| `GET` | `/images/:filename` | Serve local upload or redirect to S3 |

## Behavior Notes

- `/api/generate` streams text over SSE and can return raw HTML, `<clarify>...</clarify>`, or a structured `<diagram>...</diagram>` payload that is converted to HTML server-side.
- `/api/voice-message` transcribes with Groq Whisper, appends the transcription as a user turn, then runs the normal generation flow.
- `/api/import` currently runs the import pipeline at concurrency `8`.
- `/api/export` exports structured slides as editable PPTX content and rasterizes HTML-only slides with Playwright.

## Storage Modes

Uploads:
- local disk by default
- S3 when `S3_BUCKET` is set

Decks:
- filesystem JSON by default
- S3 when `DECK_STORAGE=s3`

Rate limiting:
- in-memory by default
- Upstash Redis when `UPSTASH_REDIS_REST_URL` is set

## Key Environment Variables

- `PORT=4000`
- `CLIENT_DEV_URL=http://localhost:5173`
- `DEFAULT_MODEL`
- `MODEL_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`
- `GROQ_API_KEY`
- `UPLOAD_DIR`
- `MAX_UPLOAD_BYTES`
- `PUBLIC_BASE_URL`
- `INTERNAL_BASE_URL`
- `S3_BUCKET`, `S3_PUBLIC_BASE_URL`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_SIGNED_URL_EXPIRES`
- `DECK_STORAGE`, `DECK_STORAGE_DIR`, `DECK_S3_BUCKET`, `DECK_S3_PREFIX`, `MAX_DECK_BYTES`
- `UPSTASH_REDIS_REST_URL`

## Development and Production Serving

- In development, the server proxies unmatched `GET` requests to the Vite dev server.
- In production, the server serves the built frontend from `app/dist`.

The current CORS allowlist is code-configured in `server/server.ts`.

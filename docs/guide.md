# Slide AI Guide

Single reference for setup, runtime behavior, env vars, and service endpoints.

## Product Summary

- Chat-first slide editor that renders sanitized HTML inside a 16:9 canvas.
- Multi-slide deck with thumbnails, duplicate/delete/new-deck controls, keyboard navigation, and local persistence.
- Structured diagram support for flowcharts, grids, and hierarchies via server-side layout generation.
- Image uploads, voice input, PPTX import, and PPTX export.
- Optional server-backed deck sync on top of localStorage.

## Repo Layout

- `app/` - Vite + React client
- `server/` - Bun API, upload, import/export, deck store, and LLM integration
- `docs/` - long-form product and deployment docs
- `ppts/` - sample PPTX files for import testing
- `e2e/` - Playwright tests

## Local Development

```sh
bun install

# Add at least one model provider key.
ANTHROPIC_API_KEY=... bun run dev
```

Optional local settings:
- `GROQ_API_KEY` enables voice transcription.
- `VITE_DECK_STORAGE=server` exercises server deck sync in development.
- `VITE_DEFAULT_MODEL=...` overrides the initial model selection.

Open `http://localhost:4000`.

Runtime notes:
- `bun run dev` runs the Bun server on `4000` and Vite on `5173`.
- In development, Bun proxies unmatched `GET` requests to `CLIENT_DEV_URL` (`http://localhost:5173` by default).
- In production, the same Bun server serves `app/dist`.

## Commands

- `bun run dev` - start Bun and Vite together
- `bun run dev:server` - start only the Bun server
- `bun run dev:client` - start only the Vite client
- `bun run build:client` - build `app/dist`
- `bun run preview` - preview the built client with Vite
- `bun test` - run unit tests across `app` and `server`
- `bun run test:coverage` - run coverage
- `bun run test:e2e`, `bun run test:e2e:headed`, `bun run test:e2e:ui`
- `bun run typecheck:client`, `bun run typecheck:server`
- `bun run preview:pptx:app -- <pptx-path> [output-dir]`
- `bun run preview:pptx -- <pptx-path> [output-dir]`
- `bun run preview:pptx:visual -- <pptx-path> [output-dir]`

Tooling notes:
- `preview:pptx:app` is the highest-fidelity import debugger. It can start the app, upload through `/api/import`, and capture the exact rendered deck state.
- `preview:pptx:visual` additionally needs Chrome or Chromium, LibreOffice or `soffice`, `pdftoppm`, and ImageMagick (`magick`, `convert`, and `identify`).

## Runtime Architecture

### Frontend

- `app/src/App.tsx` owns `slides`, `currentSlideIndex`, `messages`, and `model`.
- Each slide is `{ id, html, source? }`.
  - `html` is the rendered slide markup.
  - `source` is optional structured scene data retained for imported/editable slides.
- Hooks split responsibilities:
  - `useSlideOperations` add, delete, duplicate, and navigate slides.
  - `useSlideNavigation` wires global keyboard shortcuts when focus is outside inputs.
  - `useChatGeneration` streams model output and commits slide updates.
  - `useImportExport` imports PPTX decks and exports `.pptx` files.
  - `useDeckSync` hydrates and saves server-backed decks.
  - `useAudioRecorder` manages browser recording state.
- HTML is sanitized before it is committed to slide state.

### Generation Flow

1. The client `POST`s `messages`, `currentHtml`, and `model` to `/api/generate`.
2. The server auto-selects a model when the client chooses `auto`.
3. The server streams SSE chunks back to the client.
4. The client progressively updates the current slide with streamed HTML.
5. If the model returns `<clarify>...</clarify>`, the client rolls back the in-progress HTML and appends the clarification question to chat instead of committing a slide.
6. If the model returns `<diagram>...</diagram>`, the server converts the diagram intent to HTML before sending the final result.

### Voice Flow

1. `useAudioRecorder` captures up to 120 seconds with `MediaRecorder`.
2. The client sends multipart form data to `/api/voice-message`.
3. The server transcribes audio with Groq Whisper, appends the transcript as a user turn, then runs normal slide generation.
4. The response returns `{ html, transcription }`; clarification tags are handled the same way as text generation.

### Import and Export Flow

- `/api/import` accepts a `.pptx`, parses OOXML deterministically, uploads extracted assets, and streams progress plus per-slide results over SSE.
- Imported slides usually include both rendered HTML and structured `source` data. The UI preserves that source for future editing and export.
- `/api/export` emits a `.pptx`. Slides with `source` export as editable objects; slides without `source` are rasterized from HTML through Playwright.

## Persistence

- Local persistence uses `localStorage` key `slideai:deck:v1`.
- The active remote deck id uses `slideai:deck:id`.
- In development, deck sync defaults to local-only unless `VITE_DECK_STORAGE=server`.
- In production, the client defaults to server-backed deck sync.
- Server deck storage uses filesystem JSON by default or S3 when `DECK_STORAGE=s3`.

## API Endpoints

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Liveness probe |
| `POST` | `/api/generate` | SSE slide generation |
| `POST` | `/api/voice-message` | Audio transcription + slide generation |
| `POST` | `/api/import` | SSE PPTX import |
| `POST` | `/api/export` | Deck to `.pptx` |
| `POST` | `/api/decks` | Create remote deck |
| `GET` | `/api/decks/:id` | Load remote deck |
| `PUT` | `/api/decks/:id` | Save remote deck |
| `POST` | `/upload` | Upload image asset |
| `GET` | `/images/:filename` | Serve or redirect upload asset |

## Environment Variables

### Frontend

- `VITE_SERVER_URL` - base URL for generate, voice, import, export, and deck APIs. Defaults to `http://localhost:4000`.
- `VITE_MODEL_SERVICE_URL` - base URL for `/upload`. Defaults to `http://localhost:4000`.
- `VITE_UPLOAD_API_URL` - legacy alias for `VITE_MODEL_SERVICE_URL`.
- `VITE_DEFAULT_MODEL` - initial selected model.
- `VITE_DECK_STORAGE` - set to `server` to force remote deck sync in development.

### Backend

- `PORT` - Bun server port. Defaults to `4000`.
- `CLIENT_DEV_URL` - Vite proxy target in development. Defaults to `http://localhost:5173`.
- `DEFAULT_MODEL` - default model when the client does not choose one.
- `MODEL_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` - provider credentials.
- `GROQ_API_KEY` - required for `/api/voice-message`.
- `UPLOAD_DIR` - local upload directory.
- `MAX_UPLOAD_BYTES` - image upload size limit. Defaults to `5 MiB`.
- `PUBLIC_BASE_URL` - external base URL for generated upload links.
- `INTERNAL_BASE_URL` - override for export-time gateway fetches if loopback is unavailable.
- `S3_BUCKET`, `S3_PUBLIC_BASE_URL`, `S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE`, `S3_SIGNED_URL_EXPIRES` - upload storage configuration.
- `DECK_STORAGE` - `fs` by default, `s3` for remote deck storage.
- `DECK_STORAGE_DIR` - filesystem directory for deck JSON.
- `DECK_S3_BUCKET`, `DECK_S3_PREFIX` - S3-backed deck storage options.
- `MAX_DECK_BYTES` - deck payload limit. Defaults to `2 MiB`.
- `UPSTASH_REDIS_REST_URL` - enable Redis-backed rate limiting.
- `SLIDEAI_SILENCE_LOGS=true` - suppress logs in tests and automation.

Compatibility note:
- For local convenience, the server also accepts shared repo-root `VITE_MODEL_API_KEY`, `VITE_ANTHROPIC_API_KEY`, `VITE_OPENAI_API_KEY`, and `VITE_GOOGLE_API_KEY` values if those are already present in your env files.

## Import and Export Notes

- `/api/import` currently invokes the import pipeline with concurrency `8`.
- The lower-level import helpers cap concurrency at `8` as well.
- `unzip` is required for all imports.
- `S3_PUBLIC_BASE_URL` lets imported HTML and exported decks point at direct CDN or S3 URLs instead of gateway redirects.
- `preview:pptx:app` is the best app-level validation loop; `preview:pptx` and `preview:pptx:visual` are lower-level parser diagnostics.

## Rate Limiting

- Applied to `POST /api/generate`, `POST /api/voice-message`, and `POST /api/import`.
- Anonymous fingerprints currently get a lifetime limit of `3` requests and a `10s` throttle between allowed requests.
- Development uses in-memory storage; production can use Upstash Redis when configured.

## Further Reading

- `app/design.md` - architecture walkthrough
- `docs/slides.md` - deck and thumbnail behavior
- `docs/speech.md` - voice input workflow
- `docs/deployment.md` - deployment notes
- `server/README.md` - Bun service reference

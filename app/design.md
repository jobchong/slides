# Slide AI Architecture

## Design Principles

1. HTML-first rendering. Slides are still rendered as plain HTML inside a fixed 16:9 container.
2. Conversation-first editing. The primary editing surface is chat, not direct canvas manipulation.
3. Structured data where it improves fidelity. Imports, diagrams, and exports use structured scene data when available.
4. One service owns the heavy lifting. The Bun backend handles generation, uploads, voice, deck storage, import/export, and dev/prod serving.

## 1. State Model

- `slides: Slide[]` where `Slide` is `{ id, html, source? }`.
- `currentSlideIndex` selects the active slide.
- `messages: Message[]` stores chat history.
- `model` stores the currently selected model or `auto`.

Important behavior:
- Imported slides usually include `source` so they can be exported as editable objects later.
- Freeform chat edits commit sanitized `html` and clear `source`, because the result is no longer guaranteed to match a structured scene.
- State is persisted locally to `slideai:deck:v1`.
- The active remote deck id is stored separately in `slideai:deck:id` when server deck sync is enabled.

## 2. Rendering Layer

- `SlideView` renders the active slide with `dangerouslySetInnerHTML` inside a `.slide` container.
- `ThumbnailPanel` renders live scaled-down HTML thumbnails rather than cached screenshots.
- `SlideNavigation` provides prev/next controls and slide counts.
- `ImportProgress` displays an import modal while `/api/import` streams progress.
- `ChatInput` owns message composition, attachments, model selection, error display, chat history expansion, and audio recording controls.

## 3. Frontend Hooks

- `useSlideOperations` manages add, delete, duplicate, and navigation helpers.
- `useSlideNavigation` binds keyboard shortcuts when focus is not inside an input.
- `useChatGeneration` streams model output, handles clarification messages, and commits slide HTML.
- `useImportExport` wires PPTX import/export and incremental slide insertion.
- `useDeckSync` hydrates and auto-saves remote decks with a debounce.
- `useAudioRecorder` wraps `MediaRecorder` state and timing.

## 4. Generation Contract

`/api/generate` is SSE-based.

Client request:
- Sends `messages`, `currentHtml`, and `model`.
- The most recent user turn is combined with the current slide HTML on the server so incremental edits remain stateful.

Server response modes:
- Raw HTML for normal slide updates.
- `<clarify>...</clarify>` when the model needs a follow-up question.
- `<diagram>...</diagram>` with JSON intent for flowcharts, grids, and hierarchies.

Resolution behavior:
- Diagram intents are converted to HTML on the server through the layout engine before the client commits them.
- Clarification responses do not replace the slide; they become assistant chat messages instead.
- Streaming HTML is applied optimistically while chunks arrive, then sanitized and committed when complete.

## 5. Model Routing

- The client can explicitly choose Anthropic, OpenAI, or Gemini models.
- `auto` routes simple requests to Claude Haiku and more complex requests to Claude Sonnet based on prompt complexity heuristics.
- The Bun server holds provider credentials and makes all provider calls directly.

## 6. Uploads and Voice

Uploads:
- Images go to `/upload`.
- The returned URL is appended to the user message as attachment context.
- Uploaded assets can be stored locally or in S3, but the slide itself still references standard image URLs.

Voice:
- Browser recording uses `MediaRecorder`.
- The client sends multipart audio to `/api/voice-message`.
- The server transcribes with Groq Whisper, appends the transcript as a user turn, then runs the same generation pipeline as text chat.

## 7. PPTX Import and Export

Import:
- Deterministic OOXML parsing, no LLM calls.
- Extracts slide content, templates, backgrounds, images, and editable elements.
- Streams progress and slide results back to the client over SSE.
- Imported slides retain `source` data and render HTML produced from that source.

Export:
- Slides with `source` export as editable PPTX objects.
- Slides without `source` are rasterized from HTML through Playwright and exported as images.
- Asset URLs are normalized so local uploads, gateway URLs, and direct S3 or CDN URLs all resolve safely during export.

## 8. Backend Responsibilities

The Bun server currently owns:
- `/api/generate` and `/api/voice-message`
- `/upload` and `/images/:filename`
- `/api/import` and `/api/export`
- `/api/decks` CRUD for remote deck sync
- rate limiting for expensive routes
- Vite proxying in development and static asset serving in production

Storage options:
- Uploads: local disk by default, S3 optional
- Decks: filesystem JSON by default, S3 optional
- Rate limiting: in-memory by default, Upstash Redis optional

## 9. Current Limits

- No slide reordering or drag-and-drop sorter yet.
- No undo/redo or collaboration layer.
- Generated HTML slides are not converted back into structured scene data automatically.
- HTML-only export depends on browser rasterization rather than native editable PPTX objects.

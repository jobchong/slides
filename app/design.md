# Slide AI - MVP Architecture Design

## Design Principles

1. **HTML-native**: The model outputs real HTML with inline CSS that drops straight into the slide container.
2. **Whole-slide updates**: The LLM returns the full slide markup on every turn; no partial diffs or tool calls.
3. **Minimal surface area**: Simple React state, no backend beyond the LLM call, and no custom DSL.
4. **Conversation-first**: The user edits via chat; any ambiguity is resolved through the conversation, not UI controls.

---

## 1. Document Model & State

- **Slide state**: A single `slideHtml: string` rendered directly into the slide container. Empty string = blank slide.
- **Conversation state**: `messages: Message[]` and `isLoading: boolean` in `App.tsx`. `Message` is `{ role: "user" | "assistant"; content: string; }`.
- **Persistence**: None. Refresh resets state.
- **Update strategy**: The most recent user message is rewritten to include `Current slide HTML:\n${slideHtml}\n\nUser request: ${message}` before it is sent to the LLM, so the model always receives the entire current slide for incremental edits.

Example of expected slide HTML from the model:
```html
<div style="position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%); font-size: 64px; font-weight: 700; color: #ffffff;">
  Q4 2024 Review
</div>
<div style="position: absolute; top: 5%; right: 5%; width: 80px; height: 80px; border-radius: 50%; background-color: #e94560;"></div>
```

---

## 2. Rendering Layer

- **SlideView (`src/components/SlideView.tsx`)**: Renders `slideHtml` with `dangerouslySetInnerHTML` inside a `.slide` container. Adds a loading overlay/spinner while requests are in flight.
- **Layout**: `.slide` uses `position: relative`, `aspect-ratio: 16 / 9`, `max-width: 960px`, rounded corners, drop shadow, and white default background (see `SlideView.css`).
- **App shell**: `App.tsx` centers the slide, stacks the chat input below, and maintains full-height layout (see `App.css`).
- **Styling**: Plain CSS files (`index.css`, `App.css`, `ChatInput.css`, `SlideView.css`).

---

## 3. LLM Contract (`src/api.ts`)

- **Prompt**: A fixed system prompt instructs the model to output **only raw HTML**, no markdown/code fences, covering:
  - Absolute positioning with percentages for placement.
  - `px` sizing for dimensions and font sizes.
  - Circles via `border-radius: 50%`; text via `div`; colors via hex / RGBA.
  - Example markup and a reminder to return the **complete slide HTML** every time.
- **Images**: Use `<img>` with user-provided URLs; include explicit `width`/`height` and `object-fit: cover` (or `contain` if requested) plus `position: absolute` with percentage anchoring. If the user asks for an image without providing a URL, ask for one; do not generate SVG or inline data URIs.
- **Message shaping**: The latest user turn includes the full current slide HTML (if any) plus the new request to keep the model stateful without tool use.
- **API call**: POST to `https://api.anthropic.com/v1/messages` with model `claude-sonnet-4-20250514`, `max_tokens: 4096`, and headers `anthropic-version: 2023-06-01` and `anthropic-dangerous-direct-browser-access: true`.
- **Env**: Requires `VITE_ANTHROPIC_API_KEY`. Request failure surfaces an error message in the chat stream.

---

## 4. User Interaction Flow

1. User types in `ChatInput`. On submit, the message is appended to `messages` and `isLoading` is set.
2. `callClaude` returns full slide HTML, which replaces `slideHtml`. A synthetic assistant message `"Done."` is appended for confirmation.
3. On error, the assistant message includes the error string; spinner is cleared via `finally`.
4. Chat history can be toggled open/closed; when open it pins above the input and autoscrolls to the latest message.

---

## 5. Data Flow

```
User text
  ↓
App state update (messages + loading)
  ↓
callClaude(messages, slideHtml)
  ↓
Anthropic API with full current HTML inlined into the last user turn
  ↓
Model returns complete HTML for the slide
  ↓
slideHtml state replaces previous markup
  ↓
SlideView renders HTML + optional loading overlay
```

---

## 6. Tech Stack

| Layer | Choice | Notes |
|-------|--------|-------|
| Build | Vite + TypeScript | `npm run dev/build/preview` |
| Frontend | React 18 | Minimal hooks-only state |
| Styling | Plain CSS files | No design system or CSS-in-JS |
| LLM | Anthropic Messages API | Model `claude-sonnet-4-20250514`, HTML-only responses |
| Backend | None | All client-side calls to Anthropic |

---

## 7. Out of Scope / Known Limits

- No JSON document model or structured tool calls; everything is free-form HTML.
- No multi-slide support, templates, export, or persistence.
- No canvas or SVG; images must be external URLs placed directly in `<img>` tags (uploads planned below).
- No in-canvas selection or direct manipulation; all edits are conversational.
- No undo/redo beyond rephrasing in chat.

---

## Image Uploads (Implemented)

Goal: let users attach an image file and place it on the slide without changing the HTML-only rendering.

Current flow:
- **Upload flow**: `+` button opens a file picker (jpg/png/webp/gif) → POSTs to the image service (`VITE_UPLOAD_API_URL`, Bun/S3-backed) → receive a public URL.
- **LLM prompt shape**: When an upload completes, a user message is auto-appended: `Uploaded image available at: <url>`. The LLM continues to emit `<img>` tags using that URL, with `width/height`, `object-fit`, and absolute positioning.
- **UI affordance**: Upload list shows per-file status; Send is disabled while an upload is in flight to ensure the URL reaches the next turn.
- **Safety**: Client trusts server validation (type/size). Server rejects unsupported MIME types and large files.
- **State**: Tracks `uploads[]` with {name, url, status}. Only completed URLs are added to messages.
- **Rendering**: Slides remain raw HTML; no inline base64/data URLs; no canvas/SVG.

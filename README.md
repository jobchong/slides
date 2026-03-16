# Slide AI

Chat-driven slide builder with a React frontend and a Bun backend. The app generates sanitized slide HTML, supports multi-slide decks, structured diagrams, image uploads, voice input, PPTX import/export, and optional server-backed deck storage.

## Quick Start

```sh
bun install

# Pick one model provider. Add GROQ_API_KEY if you want voice input.
ANTHROPIC_API_KEY=... bun run dev
# or MODEL_API_KEY=...
# or OPENAI_API_KEY=...
# or GOOGLE_API_KEY=...
```

Open `http://localhost:4000`.

Notes:
- `bun run dev` starts the Bun server on `4000` and the Vite client on `5173`; the Bun server proxies the client in development.
- The client defaults to `http://localhost:4000`, so local development usually does not need `VITE_SERVER_URL` or `VITE_MODEL_SERVICE_URL`.
- Repo-root `.env.local` works well for shared local settings because Vite loads env files from the repo root and Bun reads the same environment.

## Documentation

- `docs/guide.md` - setup, runtime behavior, env vars, and API reference
- `app/design.md` - architecture walkthrough
- `docs/slides.md` - multi-slide deck behavior
- `docs/speech.md` - voice input design and constraints
- `docs/deployment.md` - production deployment notes
- `server/README.md` - Bun service details and endpoint reference

## Common Commands

- `bun run dev`, `bun run dev:server`, `bun run dev:client`
- `bun run build:client`, `bun run preview`
- `bun test`, `bun run test:coverage`, `bun run test:e2e`
- `bun run typecheck:client`, `bun run typecheck:server`
- `bun run preview:pptx:app -- ppts/template1.pptx`
- `bun run preview:pptx -- ppts/template1.pptx`
- `bun run preview:pptx:visual -- ppts/fullTemplate1.pptx`

Use `preview:pptx:app` as the default parser-debug loop. It exercises the real `/api/import` path and captures the rendered `.slide` output, `deck-state.json`, per-slide HTML/source files, and screenshots. `preview:pptx:visual` is a lower-level diff tool and additionally needs Chrome or Chromium, LibreOffice, `pdftoppm`, and ImageMagick.

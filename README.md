# Slide AI (Monolith)

Chat-driven slide builder (React) with a Bun model service for LLM, uploads, voice, and PPTX import.

## Quick Start
```sh
bun install
VITE_MODEL_API_KEY=... VITE_MODEL_SERVICE_URL=http://localhost:4000 bun run dev
```

Open the app on `http://localhost:4000` (the server proxies the client to avoid CORS preflights).

## Documentation
All setup, architecture, feature specs, and env vars live in `docs/guide.md`.
Additional deep dives:
- `app/design.md`
- `docs/slides.md`
- `docs/speech.md`

## Testing
```sh
bun test
```

PPTX import preview helpers:
```sh
bun run preview:pptx:app -- ppts/template1.pptx
bun run preview:pptx -- ppts/template1.pptx
bun run preview:pptx:visual -- ppts/fullTemplate1.pptx
```

Use `preview:pptx:app` as the default parser-debug loop. It uploads the PPTX through the real app, waits for `/api/import`, and captures the same rendered `.slide` output a user sees, along with `deck-state.json`, per-slide HTML, and screenshots.

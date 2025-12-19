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

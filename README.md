# Slide AI (Monolith)

Single repo with the chat-driven slide builder and the Bun-based model service (uploads + LLM + voice).

## Layout
- `app/`: Vite + React UI. See `app/design.md` for architecture and the LLM contract.
- `server/`: Bun model service (uploads, LLM, voice) returning public URLs for the UI.
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

Server env toggles:
- `PORT` (default `4000`)
- `UPLOAD_DIR` (default `<repo>/server/uploads`)
- `PUBLIC_BASE_URL` (override host/proto when behind a proxy)
- `MAX_UPLOAD_BYTES` (default `5MB`)
- `S3_BUCKET` (enables S3 storage when set)
- `S3_REGION` (default `us-east-1`)
- `S3_ENDPOINT` / `S3_FORCE_PATH_STYLE` (for MinIO/Localstack/custom endpoints)
- `S3_SIGNED_URL_EXPIRES` (seconds for presigned GETs; default `3600`)
- `MODEL_API_KEY` (generic key for the selected model; falls back to `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`)
- `DEFAULT_MODEL` (defaults to `claude-3.5-sonnet-20241022` if omitted)

Frontend env:
- `VITE_MODEL_API_KEY` (preferred; falls back to `VITE_ANTHROPIC_API_KEY` or `VITE_OPENAI_API_KEY`)
- `VITE_MODEL_SERVICE_URL` (model service base, default `http://localhost:4000`)
- `VITE_UPLOAD_API_URL` (deprecated alias for the model service base; fallback support remains)
- `VITE_SERVER_URL` (voice endpoint base, default `http://localhost:4000`)
- `VITE_DEFAULT_MODEL` (optional override for initial model in the picker)

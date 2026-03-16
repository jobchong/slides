# Deployment

## Recommended: Fly.io Monolith

The repo ships as a single Bun service. The production container:
- builds the Vite frontend into `app/dist`
- runs the Bun server on port `4000`
- serves the built frontend and all API routes from the same process
- installs `unzip` so PPTX import works in production

### First Deploy

```sh
# One-time setup
fly auth login
fly launch --no-deploy

# Minimum required secret: one model provider key
fly secrets set ANTHROPIC_API_KEY=sk-ant-...

# Optional if you want voice input
fly secrets set GROQ_API_KEY=gsk_...

# Deploy
bun run deploy
```

The repo already includes:
- `Dockerfile`
- `fly.toml`
- `bun run deploy`

### Useful Production Secrets

- Model providers:
  - `MODEL_API_KEY`
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `GOOGLE_API_KEY`
- Voice:
  - `GROQ_API_KEY`
- Uploads:
  - `S3_BUCKET`
  - `S3_REGION`
  - `S3_ENDPOINT`
  - `S3_FORCE_PATH_STYLE`
  - `S3_PUBLIC_BASE_URL`
- Deck storage:
  - `DECK_STORAGE=s3`
  - `DECK_S3_BUCKET`
  - `DECK_S3_PREFIX`
  - `MAX_DECK_BYTES`
- Rate limiting:
  - `UPSTASH_REDIS_REST_URL`

### Notes

- Filesystem uploads and filesystem deck storage work for single-instance deployments, but object storage is safer if you expect machine restarts or multiple instances.
- `S3_PUBLIC_BASE_URL` is useful when you want imported HTML and exported decks to use direct CDN or S3 asset URLs instead of `/images/...` redirects.
- The server serves the production frontend itself, so you do not need a separate static host for the default Fly setup.

## Browser and Native Tooling Requirements

Some features need more than just Bun:

- PPTX import needs `unzip`.
- `bun run preview:pptx:app` and `bun run preview:pptx:visual` need Chrome or Chromium.
- `bun run preview:pptx:visual` also needs LibreOffice or `soffice`, `pdftoppm`, and ImageMagick.
- PPTX export rasterizes HTML-only slides through Playwright, so container deployments that use that path need a working Chromium runtime.

If you only export slides that still have structured `source` data from import, export fidelity is better and the rasterization fallback is used less often.

## Split Deployment: Static Frontend + Remote API

You can deploy the frontend separately and point it at a remote Bun server.

### Frontend

Build the client with:

```sh
bun run build:client
```

Publish `app/dist` and set:
- `VITE_SERVER_URL=https://your-api.example.com`
- `VITE_MODEL_SERVICE_URL=https://your-api.example.com`
- `VITE_DECK_STORAGE=server` if you want remote deck sync outside production defaults

### Backend

Deploy the Bun server with the same env vars described above. The root `Dockerfile` already builds the frontend, so it also works unchanged for container platforms such as App Runner, Render, or Railway.

### CORS

The server CORS allowlist is currently code-configured in `server/server.ts`, not environment-configured. If your frontend runs on a different origin than:
- `https://slidespell.com`
- `https://www.slidespell.com`
- `http://localhost:5173`

then update the allowlist before deploying the split setup.

# AGENTS.md

Quick orientation for agents working in this repo:

- **Product**: Slide AI — chat-driven slide builder with uploads, LLM generation, and voice input.
- **Primary docs**: `README.md` (setup, env), `CLAUDE.md` (coding conventions), `app/design.md` (architecture).
- **Specs**: `docs/slides.md` (multi-slide management), `docs/speech.md` (speech input design).
- **Entrypoints**: Frontend in `app/`, Bun model service in `server/`.
- **Scripts**: `bun run dev`, `bun run dev:server`, `bun run dev:client`, `bun run typecheck:client`, `bun run typecheck:server`.
- **Notes**: PPTX import concurrency is fixed at `8` server-side; set `S3_PUBLIC_BASE_URL` to emit direct S3/CDN image URLs in generated HTML when using S3 storage.

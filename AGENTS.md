# AGENTS.md

Quick orientation for agents working in this repo:

- **Product**: Slide AI — chat-driven slide builder with uploads, LLM generation, and voice input.
- **Primary docs**: `README.md` (setup, env), `CLAUDE.md` (coding conventions), `app/design.md` (architecture).
- **Specs**: `docs/slides.md` (multi-slide management), `docs/speech.md` (speech input design).
- **Entrypoints**: Frontend in `app/`, Bun model service in `server/`.
- **Scripts**: `bun run dev`, `bun run dev:server`, `bun run dev:client`, `bun run typecheck:client`, `bun run typecheck:server`.
- **Notes**: PPTX import concurrency is fixed at `8` server-side; set `S3_PUBLIC_BASE_URL` to emit direct S3/CDN image URLs in generated HTML when using S3 storage.

## Autonomy loop expectations

- **Mode**: Work mostly autonomously. Only ask when a shell command or URL needs permission; do not spend time on workarounds.
- **Loop**: Identify a concrete product improvement, implement it, review output, add tests, commit, then immediately move to the next improvement.
- **Validation**: Prefer inspecting generated HTML/JSON output and diffs; you cannot open a browser here.
- **Commits**: Commit after each improvement loop so changes are easy to revert. Use concise conventional commit messages (e.g., `fix: ...`, `feat: ...`).

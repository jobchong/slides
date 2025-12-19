# CLAUDE.md

This file provides guidance for Claude Code when working on this repository.

## Project Overview

Primary docs now live in `docs/guide.md`. This file stays focused on coding conventions and agent-specific guidance.

## Coding Conventions

### TypeScript
- Strict mode enabled in both client and server tsconfigs
- `noUnusedLocals` and `noUnusedParameters` enabled (client)
- Export shared types from `types.ts`

### React
- Hooks only, no class components
- Event handlers named `handleSomething()`
- State in root component, props passed down

### CSS
- Plain CSS with BEM-lite naming (`.chat-input`, `.chat-input-row`)
- CSS variables in `app/src/index.css` for colors
- 150-200ms transitions for interactive states

### File Organization
- Component files paired with `.css` files
- Hooks in `app/src/hooks/`
- Single responsibility per file

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | /health | Health check |
| POST | /api/generate | Generate slide HTML from chat |
| POST | /api/voice-message | Transcribe audio + generate slide |
| POST | /upload | Upload image file |
| GET | /images/{filename} | Serve uploaded image |

## Keyboard Shortcuts

- Arrow Left/Up: Previous slide
- Arrow Right/Down: Next slide
- Home/End: First/Last slide
- Ctrl/Cmd+M: Add new slide
- Delete/Backspace: Delete current slide

## Documentation

- `docs/guide.md` - consolidated overview (setup, env, architecture, specs)
- `app/design.md` - architecture deep dive
- `docs/slides.md` - multi-slide feature spec
- `docs/speech.md` - voice input design

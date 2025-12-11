# CLAUDE.md

This file provides guidance for Claude Code when working on this repository.

## Project Overview

**Slide AI** is an LLM-powered presentation builder. Users describe slides in chat, and Claude/GPT generates HTML that renders directly in the browser. Features include multi-slide support, voice input (Groq Whisper), and image uploads (S3 or disk storage).

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite 6, TypeScript 5.6 (strict) |
| Backend | Bun runtime (port 4000) |
| Styling | Plain CSS with CSS variables |
| LLM | Anthropic Claude API, OpenAI API, Google Gemini API |
| Voice | Groq Whisper API |
| Storage | Disk (default) or AWS S3 |

## Project Structure

```
app/                    # React frontend (Vite)
  src/
    components/         # React components + paired .css files
    hooks/              # Custom React hooks
    App.tsx             # Root component with all state
    api.ts              # Server API calls
    types.ts            # TypeScript interfaces
    models.ts           # LLM model options
server/                 # Bun backend
  server.ts             # HTTP routes, file uploads
  llm.ts                # Anthropic/OpenAI/Google integration
  groq.ts               # Whisper transcription
  uploads/              # Disk-based image storage
```

## Commands

```bash
# Install dependencies
bun install

# Development (runs both client and server)
bun run dev

# Development (separate processes)
bun run dev:server      # Server on port 4000
bun run dev:client      # Vite on port 5173

# Type checking
bun run typecheck:client
bun run typecheck:server

# Build for production
bun run build:client

# Preview production build
bun run preview
```

## Environment Variables

### Frontend (prefix with `VITE_`)
- `VITE_MODEL_API_KEY` - API key for selected model
- `VITE_ANTHROPIC_API_KEY` - Fallback Anthropic key
- `VITE_OPENAI_API_KEY` - Fallback OpenAI key
- `VITE_MODEL_SERVICE_URL` - Model service base URL (default: http://localhost:4000)
- `VITE_UPLOAD_API_URL` - Deprecated alias for the model service base (default: http://localhost:4000)
- `VITE_SERVER_URL` - Voice endpoint URL (default: http://localhost:4000)

### Backend
- `PORT` - Server port (default: 4000)
- `MODEL_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GOOGLE_API_KEY` - LLM API keys
- `GROQ_API_KEY` - Required for voice transcription
- `S3_BUCKET` - Enable S3 storage (optional)
- `UPLOAD_DIR` - Disk upload directory (default: server/uploads)

## Architecture Notes

### State Management
- All state in `App.tsx`: `slides[]`, `currentSlideIndex`, `messages[]`, `model`, `isLoading`
- Slides are `{ id: string; html: string }` objects
- No persistence (state resets on refresh)

### LLM Contract
The system prompt in `server/llm.ts` instructs models to:
- Output ONLY raw HTML, no markdown or code fences
- Use absolute positioning with percentage-based top/left/right/bottom
- Use `px` for font-size, width, height
- Return COMPLETE slide HTML on every turn (not diffs)
- Use `<img>` tags for images (no SVG or data URIs)

### Key Design Decisions
- **HTML-native**: LLM outputs raw HTML with inline styles
- **Whole-slide updates**: Complete HTML on every turn
- **Conversation-first**: Users edit via chat, full context always included

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

- `README.md` - Quick start guide
- `app/design.md` - Architecture deep dive
- `slides.md` - Multi-slide feature spec
- `speech.md` - Voice input design

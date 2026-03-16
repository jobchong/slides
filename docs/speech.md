# Speech Input

Current design and implementation notes for voice input in the slide chat flow.

## Overview

Voice input is browser-recorded audio plus server-side transcription. The app does not show a live transcript while recording. Instead, it records audio, uploads the blob, transcribes it with Groq Whisper on the server, and feeds the resulting text through the same generation pipeline used for typed chat.

## Recording States

`useAudioRecorder` exposes five states:

- `idle`
- `recording`
- `uploading`
- `processing`
- `error`

The UI uses those states to swap between:
- normal text input
- inline `Listening...` indicator with timer
- upload / processing status messages
- retryable error state

## Client Flow

1. User clicks the microphone button.
2. The browser requests microphone permission if needed.
3. `MediaRecorder` starts with the first supported MIME type from:
   - `audio/webm;codecs=opus`
   - `audio/webm`
   - `audio/ogg;codecs=opus`
   - `audio/mp4`
4. The UI shows an inline recording indicator and a running timer.
5. Clicking the mic again stops recording and immediately uploads the audio.
6. The client sends multipart form data to `/api/voice-message` with:
   - `audio`
   - `messages`
   - `currentHtml`
   - `model`
7. The response returns a transcription plus generated HTML.

## Server Flow

1. Validate audio presence, MIME type, and size.
2. Transcribe with Groq Whisper.
3. Append the transcription as a user message.
4. Run normal slide generation with the selected model or `auto`.
5. Return:

```json
{
  "html": "<div>...</div>",
  "transcription": "create a timeline with three milestones"
}
```

If the model asks for clarification via `<clarify>...</clarify>`, the client treats it the same way as a text chat clarification turn and does not replace the current slide.

## Limits and Validation

- Max recording length in the browser: `120` seconds
- Max upload size on the server: `25 MiB`
- Accepted server MIME types:
  - `audio/webm`
  - `audio/webm;codecs=opus`
  - `video/webm`
  - `audio/mp4`
  - `audio/mpeg`
  - `audio/wav`
  - `audio/ogg`
  - `audio/ogg;codecs=opus`

Notes:
- Some browsers report audio-only WebM as `video/webm`; the server accepts that.
- The client records in 100ms chunks and stops the input stream on cancel or completion.

## UX Details

- No live transcript is shown while recording.
- `Escape` cancels an active recording.
- After successful voice generation, the app appends the transcript as the user turn.
- The assistant turn is either `Done.` or a clarification question.
- The text input is re-focused after voice generation completes.

## Environment

- `GROQ_API_KEY` is required for voice transcription.
- Voice requests still use the current `model` selection for slide generation after transcription.

## Implementation Files

- `app/src/components/ChatInput.tsx`
- `app/src/hooks/useAudioRecorder.ts`
- `app/src/api.ts`
- `server/audio.ts`
- `server/groq.ts`
- `server/server.ts`

## Current Constraints

- No live or streaming transcription.
- No recording preview or playback before upload.
- No language picker in the UI.
- Audio is processed per message rather than as a continuous conversation stream.

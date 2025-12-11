# Speech Input Implementation

## Overview
This document outlines the design decisions and implementation details for adding speech input to the slides chat interface. Speech input uses audio recording in the browser, transcription via Groq Whisper API on the backend, and direct processing by Claude without showing intermediate text.

## Implementation Choices

### 1. Speech Recognition Technology

**Choice: Groq Whisper API (Backend Transcription)**

**Justification:**
- **Superior accuracy**: Whisper is state-of-the-art for speech recognition
- **Fast processing**: Groq's LPU inference is extremely fast (~0.3s for transcription)
- **Cost-effective**: Groq offers competitive pricing for Whisper API
- **Consistent behavior**: Works the same across all browsers (not browser-dependent)
- **Direct to Claude**: Audio → Whisper → Claude in one flow, no intermediate UI state
- **Privacy control**: Audio processed on our backend, not sent to browser vendors
- **Better UX**: User speaks naturally without seeing partial transcriptions that might be wrong

**Alternatives considered:**
- **Web Speech API**: Browser-dependent, less accurate, shows distracting interim results, limited language support
- **OpenAI Whisper API**: Slower than Groq, more expensive
- **Client-side Whisper**: Large model files (~1GB), requires significant compute

**Architecture Flow:**
```
User clicks mic → Records audio (MediaRecorder) → User clicks stop →
Upload audio blob → Groq Whisper transcription →
Send transcription to the selected model → Return slide HTML
```

### 2. User Interface Design

**Choice: Inline recording mode with animated indicator**

**Recording States:**
1. **Idle**: Microphone button visible in chat actions area
2. **Recording**:
   - Text input field smoothly replaced with "Listening..." indicator
   - Animated red pulsing dot + "Listening..." text + timer
   - Microphone button expands to show "Stop" text with red gradient
   - Cancel button appears in place of upload button
   - Send button hidden during recording
3. **Uploading**: "Uploading audio..." indicator
4. **Processing**: "Transcribing and generating..." indicator
5. **Error**: Error message with option to retry or cancel

**Justification:**
- **Subtle**: Recording mode stays within the input area, less disruptive
- **Clear feedback**: Animated pulsing dot and "Stop" button clearly show recording is active
- **Intentional interaction**: User must click "Stop" to send, preventing accidental submissions
- **No partial text**: Avoids showing potentially incorrect interim transcriptions
- **Smooth transitions**: Input field fades/slides smoothly between states
- **Accessible**: Cancel option readily available without blocking workflow

### 3. User Experience Flow

**Recording flow:**
1. User clicks microphone button
2. Browser requests microphone permission (first time only)
3. UI transitions to recording mode (200ms smooth transition):
   - Text input field fades out
   - "Listening..." indicator fades in with animated pulsing red dot
   - Timer starts counting (e.g., "0:03")
   - Microphone button expands and shows "Stop" text with red gradient glow
   - Upload button replaced with "Cancel" button
   - Send button hidden
4. User speaks their message (max 2 minutes)
5. User clicks "Stop" button to finish
6. Audio is immediately sent to backend:
   - "Uploading audio..." shown briefly
   - "Transcribing and generating..." while processing
7. Server transcribes with Whisper and generates slide with the chosen model
8. UI returns to normal state with new slide displayed

**Features:**
- **One-click send**: "Stop" button automatically sends to backend
- **Visual timer**: Shows recording duration in MM:SS format
- **Cancel option**: ESC key or "Cancel" button to abort without sending
- **Inline UI**: Recording stays in the input area, less disruptive
- **Smooth animations**: Fade transitions between states
- **Fast feedback**: Groq Whisper processes in ~300ms

### 4. Technical Implementation

**Frontend (Client):**
```
ChatInput.tsx
  └─ useAudioRecorder() hook
     ├─ MediaRecorder API for audio capture
     ├─ Manages recording state
     ├─ Handles audio blob creation
     ├─ Upload to backend endpoint
     └─ Error handling
```

**Backend (Server):**
```
POST /api/voice-message
  ├─ Receive audio file (multipart/form-data)
  ├─ Send to Groq Whisper API for transcription
  ├─ Use transcription as user message
  ├─ Send to Claude API (existing logic)
  └─ Return slide HTML
```

**Audio Recording:**
- Uses `MediaRecorder` API with WebM/Opus format (preferred)
- Tries multiple codecs: audio/webm;codecs=opus, audio/webm, audio/ogg;codecs=opus, audio/mp4
- Note: MediaRecorder may report MIME type as "video/webm" even for audio-only (this is normal)
- Enhanced audio constraints: echo cancellation, noise suppression, 44.1kHz sample rate
- Records in chunks for better memory management
- Max recording length: 2 minutes (configurable)

**State Management:**
```typescript
type RecordingState = "idle" | "recording" | "uploading" | "processing" | "error";
- isRecording: boolean
- recordingState: RecordingState
- recordingDuration: number (seconds)
- audioBlob: Blob | null
- error: string | null
```

**API Integration:**
- Groq Whisper endpoint: `https://api.groq.com/openai/v1/audio/transcriptions`
- Model: `whisper-large-v3` (best accuracy) or `whisper-large-v3-turbo` (faster)
- Audio format: WebM, MP3, or WAV
- Max file size: 25MB (Groq limit)

### 5. Accessibility

**Considerations:**
- ARIA labels for recording button and states
- ARIA live regions announce state changes ("Recording", "Processing")
- Keyboard shortcuts:
  - Space/Enter: Start/stop recording (when mic button focused)
  - ESC: Cancel recording
- High contrast recording indicator
- Screen reader announces recording duration
- Error messages are announced immediately

### 6. Privacy & Permissions

**Approach:**
- Microphone permission requested on first use only
- Large pulsing indicator makes recording state obvious
- Audio sent to our backend, not third parties directly
- Audio not stored on server (transcribed and discarded)
- User has full control: can cancel anytime before sending

**Data Flow:**
1. Audio recorded in browser
2. Sent to our backend via HTTPS
3. Backend forwards to Groq Whisper API
4. Transcription returned, audio discarded
5. Transcription sent to the selected model
6. Only slide HTML returned to client

**Browser Permission Model:**
- Users must explicitly grant microphone access
- Permission persists across sessions
- Users can revoke in browser settings
- Requires HTTPS in production

## Future Enhancements

Potential improvements for future iterations:

1. **Language selection**: Allow users to select transcription language (Whisper supports 90+ languages)
2. **Voice commands**: Special commands like "undo", "clear slide", "new slide"
3. **Audio playback**: Let users review their recording before sending
4. **Waveform visualization**: Show audio waveform during recording
5. **Background noise reduction**: Pre-process audio to improve quality
6. **Speaker diarization**: Detect multiple speakers (for collaboration)
7. **Streaming transcription**: Send audio chunks for faster feedback (if Groq supports)
8. **Offline mode**: Cache audio and process when back online

## Browser Support

MediaRecorder API is widely supported:

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome 47+ | ✅ Full | WebM/Opus support |
| Edge 79+ | ✅ Full | Chromium-based |
| Safari 14.1+ | ✅ Full | Requires user gesture to start |
| Firefox 25+ | ✅ Full | WebM/Opus support |
| Mobile Chrome | ✅ Full | Works on Android 5+ |
| Mobile Safari | ✅ Full | Works on iOS 14.3+ |

**Coverage:** ~98% of users (much better than Web Speech API)

## Security Considerations

- Requires HTTPS in production (microphone access not allowed on HTTP)
- Audio data transmitted securely via HTTPS
- Audio not stored on backend (transcribed and discarded immediately)
- Server validates audio file size and format
- Rate limiting on voice endpoint to prevent abuse
- Users maintain full control over microphone access
- Permission requests are explicit and user-initiated

## Testing Plan

1. **Recording functionality**:
   - Test microphone permission flow
   - Test audio recording quality
   - Test max recording duration limit
   - Test cancel recording flow

2. **Backend integration**:
   - Test audio upload to backend
   - Test Groq Whisper transcription accuracy
   - Test error handling (network failures, API errors)
   - Test with various audio formats

3. **UI/UX**:
   - Test recording mode transitions (show/hide input)
   - Test animated recording indicator
   - Test timer accuracy
   - Test loading states

4. **Cross-browser**:
   - Test on Chrome, Safari, Firefox, Edge
   - Test on mobile devices (iOS, Android)
   - Test microphone permissions on each browser

5. **Accessibility**:
   - Test with screen readers
   - Test keyboard navigation
   - Test ARIA announcements

## Implementation Files

**Frontend:**
- `app/src/components/ChatInput.tsx`: Recording UI and mode management
- `app/src/components/ChatInput.css`: Recording mode styles and animations
- `app/src/hooks/useAudioRecorder.ts`: MediaRecorder logic and audio handling
- `app/src/api.ts`: Voice message API endpoint call

**Backend:**
- `server/server.ts`: New `/api/voice-message` endpoint
- `server/groq.ts`: Groq Whisper API integration (new file)

**Environment:**
- `.env`: Add `GROQ_API_KEY`

## Cost Analysis

**Groq Whisper Pricing (as of 2024):**
- Whisper large-v3: ~$0.111 per hour of audio
- Average message: ~10 seconds = $0.0003 per message
- 1000 messages: ~$0.30

**Extremely cost-effective** compared to alternatives.

## Conclusion

The Groq Whisper approach provides superior accuracy, consistent cross-browser behavior, and a cleaner UX compared to Web Speech API. The backend integration adds minimal complexity while giving us full control over the transcription quality and user experience. The cost is negligible, and the fast Groq LPU inference keeps latency low (~300-500ms total).

import type { Message, Slide, SlideSource } from "./types";

export interface StreamResult {
  html: string;
  clarification: string | null;
}

function createClarifyExtractor() {
  const OPEN = "<clarify>";
  const CLOSE = "</clarify>";

  let isInClarify = false;
  let accumulatedHtml = "";
  let clarification = "";
  let buffer = "";

  const overlap = (haystack: string, token: string) => {
    const max = Math.min(haystack.length, token.length - 1);
    for (let i = max; i >= 1; i--) {
      if (token.startsWith(haystack.slice(-i))) return i;
    }
    return 0;
  };

  const appendChunk = (chunk: string) => {
    buffer += chunk;

    while (buffer.length) {
      if (isInClarify) {
        const closeIdx = buffer.indexOf(CLOSE);
        if (closeIdx === -1) {
          const keep = overlap(buffer, CLOSE);
          clarification += buffer.slice(0, buffer.length - keep);
          buffer = buffer.slice(buffer.length - keep);
          return;
        }

        clarification += buffer.slice(0, closeIdx);
        buffer = buffer.slice(closeIdx + CLOSE.length);
        isInClarify = false;
      } else {
        const openIdx = buffer.indexOf(OPEN);
        if (openIdx === -1) {
          const keep = overlap(buffer, OPEN);
          accumulatedHtml += buffer.slice(0, buffer.length - keep);
          buffer = buffer.slice(buffer.length - keep);
          return;
        }

        accumulatedHtml += buffer.slice(0, openIdx);
        buffer = buffer.slice(openIdx + OPEN.length);
        isInClarify = true;
      }
    }
  };

  const snapshot = () => ({
    html: accumulatedHtml.trim(),
    clarification: clarification.trim() || null,
  });

  const finalize = () => {
    if (buffer.length) {
      if (isInClarify) {
        clarification += buffer;
      } else {
        accumulatedHtml += buffer;
      }
      buffer = "";
    }
    return snapshot();
  };

  return { appendChunk, snapshot, finalize };
}

export async function callModelStream(
  messages: Message[],
  currentHtml: string,
  model: string,
  onChunk: (html: string) => void
): Promise<StreamResult> {
  const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
  const response = await fetch(`${serverUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, currentHtml, model }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Generate failed with ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  const clarifyExtractor = createClarifyExtractor();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") {
          return clarifyExtractor.finalize();
        }
        try {
          const parsed = JSON.parse(data);
          if (typeof parsed === "string") {
            clarifyExtractor.appendChunk(parsed);
            const { html } = clarifyExtractor.snapshot();
            onChunk(html);
          } else if (parsed.error) {
            throw new Error(parsed.error);
          }
        } catch (e) {
          if (e instanceof SyntaxError) {
            // Skip malformed JSON
            continue;
          }
          throw e;
        }
      }
    }
  }

  return clarifyExtractor.finalize();
}

export async function sendVoiceMessage(
  audioBlob: Blob,
  messages: Message[],
  currentHtml: string,
  model: string
): Promise<{ html: string; transcription: string }> {
  const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

  // Determine file extension based on MIME type
  let filename = "recording.webm";
  if (audioBlob.type.includes("mp4")) {
    filename = "recording.mp4";
  } else if (audioBlob.type.includes("ogg")) {
    filename = "recording.ogg";
  } else if (audioBlob.type.includes("wav")) {
    filename = "recording.wav";
  }

  console.log(`Sending audio: ${audioBlob.type} (${audioBlob.size} bytes) as ${filename}`);

  const formData = new FormData();
  formData.append("audio", audioBlob, filename);
  formData.append("messages", JSON.stringify(messages));
  formData.append("currentHtml", currentHtml);
  formData.append("model", model);

  const response = await fetch(`${serverUrl}/api/voice-message`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to process voice message");
  }

  return await response.json();
}

export interface ImportProgress {
  type: "progress" | "slide" | "error" | "done";
  current?: number;
  total?: number;
  status?: string;
  index?: number;
  html?: string;
  source?: SlideSource;
  error?: string;
}

export async function importPptx(
  file: File,
  onProgress: (progress: ImportProgress) => void,
  onSlide: (slide: Slide) => void
): Promise<void> {
  const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${serverUrl}/api/import`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Import failed with ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") {
          return;
        }
        try {
          const parsed = JSON.parse(data) as ImportProgress;
          if (parsed.type === "slide" && parsed.html !== undefined) {
            onSlide({
              id: crypto.randomUUID(),
              html: parsed.html,
              source: parsed.source,
            });
          }
          onProgress(parsed);
        } catch (e) {
          if (e instanceof SyntaxError) {
            continue;
          }
          throw e;
        }
      }
    }
  }
}

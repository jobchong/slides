import type { Message, Slide, SlideSource } from "./types";

export interface StreamResult {
  html: string;
  clarification: string | null;
}

/** Timeout for API requests in milliseconds */
const REQUEST_TIMEOUT = 60_000;

/** Parse error response, handling both JSON and plain text */
async function parseErrorResponse(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return json.error || `Request failed with ${response.status}`;
  } catch {
    return text || `Request failed with ${response.status}`;
  }
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, currentHtml, model }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request timed out");
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new Error(errorMessage);
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
      const trimmedLine = line.trimEnd();
      if (trimmedLine.startsWith("data: ")) {
        const data = trimmedLine.slice(6);
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

function extractClarification(raw: string): { html: string; clarification: string | null } {
  const match = raw.match(/<clarify>([\s\S]*?)<\/clarify>/);
  if (match) {
    const clarification = match[1].trim();
    const html = raw.replace(/<clarify>[\s\S]*?<\/clarify>/g, "").trim();
    return { html, clarification };
  }
  return { html: raw, clarification: null };
}

export async function sendVoiceMessage(
  audioBlob: Blob,
  messages: Message[],
  currentHtml: string,
  model: string
): Promise<{ html: string; transcription: string; clarification: string | null }> {
  const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

  // Determine file extension based on MIME type
  const filename = resolveAudioFilename(audioBlob.type);

  const formData = new FormData();
  formData.append("audio", audioBlob, filename);
  formData.append("messages", JSON.stringify(messages));
  formData.append("currentHtml", currentHtml);
  formData.append("model", model);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/voice-message`, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Voice request timed out");
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new Error(errorMessage);
  }

  const data = await response.json();
  const { html, clarification } = extractClarification(data.html);
  return { html, transcription: data.transcription, clarification };
}

export function resolveAudioFilename(mimeType: string): string {
  const lowered = mimeType.toLowerCase();
  if (lowered.includes("mp4")) return "recording.mp4";
  if (lowered.includes("mpeg")) return "recording.mp3";
  if (lowered.includes("ogg")) return "recording.ogg";
  if (lowered.includes("wav")) return "recording.wav";
  if (lowered.includes("webm")) return "recording.webm";
  return "recording.webm";
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
  onSlide: (slide: Slide) => void,
  options?: { signal?: AbortSignal }
): Promise<void> {
  const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${serverUrl}/api/import`, {
    method: "POST",
    body: formData,
    signal: options?.signal,
  });

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new Error(errorMessage);
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
      const trimmedLine = line.trimEnd();
      if (trimmedLine.startsWith("data: ")) {
        const data = trimmedLine.slice(6);
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

export async function exportDeck(slides: Slide[]): Promise<Blob> {
  const serverUrl = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slides }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Export request timed out");
    }
    throw err;
  }
  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorMessage = await parseErrorResponse(response);
    throw new Error(errorMessage);
  }

  return response.blob();
}

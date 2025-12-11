import type { Message } from "./types";

export async function callModelStream(
  messages: Message[],
  currentHtml: string,
  model: string,
  onChunk: (html: string) => void
): Promise<string> {
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
  let accumulated = "";
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
          return accumulated;
        }
        try {
          const parsed = JSON.parse(data);
          if (typeof parsed === "string") {
            accumulated += parsed;
            onChunk(accumulated);
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

  return accumulated;
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

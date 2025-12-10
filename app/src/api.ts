import type { Message } from "./types";

export async function callModel(
  messages: Message[],
  currentHtml: string,
  model: string
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

  const data = await response.json();
  return data.html || "";
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

export async function transcribeAudio(audioFile: File): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY not set");
  }

  console.log(`Transcribing audio with Groq: ${audioFile.type} (${audioFile.size} bytes)`);

  const formData = new FormData();
  formData.append("file", audioFile);
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("response_format", "json");

  const response = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const error = await response.text();
    console.error(`Groq API error: ${error}`);
    throw new Error(`Groq API error: ${error}`);
  }

  const data = await response.json();
  console.log(`Transcription successful: "${data.text}"`);
  return data.text || "";
}

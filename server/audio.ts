const allowedAudioTypes = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "video/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/ogg;codecs=opus",
]);

export function isAllowedAudioType(mimeType: string): boolean {
  return allowedAudioTypes.has(mimeType.toLowerCase());
}

export function getAllowedAudioTypes(): string[] {
  return Array.from(allowedAudioTypes);
}

import { describe, expect, test } from "bun:test";

import { getAllowedAudioTypes, isAllowedAudioType } from "../audio";

describe("audio MIME validation", () => {
  test("accepts Ogg/Opus recorder output", () => {
    expect(isAllowedAudioType("audio/ogg;codecs=opus")).toBe(true);
  });

  test("matches MIME types case-insensitively", () => {
    expect(isAllowedAudioType("Audio/Ogg;Codecs=Opus")).toBe(true);
  });

  test("exposes the supported MIME types in error-message order", () => {
    expect(getAllowedAudioTypes()).toContain("audio/ogg;codecs=opus");
    expect(getAllowedAudioTypes()).toContain("audio/webm;codecs=opus");
  });
});

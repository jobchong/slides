import { describe, expect, test } from "bun:test";

import { callModelStream, importPptx, resolveAudioFilename } from "../api";

describe("callModelStream", () => {
  test("handles CRLF SSE line endings", async () => {
    const originalFetch = globalThis.fetch;
    const encoder = new TextEncoder();
    const chunks = [
      `data: "Hello"\r\n\r\n`,
      `data: [DONE]\r\n\r\n`,
    ];

    globalThis.fetch = async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    };

    try {
      let latest = "";
      const result = await callModelStream([], "", "auto", (html) => {
        latest = html;
      });

      expect(latest).toBe("Hello");
      expect(result.html).toBe("Hello");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("passes abort signals to import fetch", async () => {
    const originalFetch = globalThis.fetch;
    const controller = new AbortController();
    let receivedSignal: AbortSignal | null = null;

    globalThis.fetch = async (_url, options) => {
      receivedSignal = (options?.signal as AbortSignal) || null;
      const stream = new ReadableStream<Uint8Array>({
        start(controllerStream) {
          controllerStream.close();
        },
      });
      return new Response(stream, { status: 200 });
    };

    try {
      const file = new File([new Uint8Array([1, 2, 3])], "test.pptx", {
        type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      });
      await importPptx(file, () => {}, () => {}, { signal: controller.signal });
      expect(receivedSignal).toBe(controller.signal);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("resolves filenames for common audio types", () => {
    expect(resolveAudioFilename("audio/mpeg")).toBe("recording.mp3");
    expect(resolveAudioFilename("audio/mp4")).toBe("recording.mp4");
    expect(resolveAudioFilename("audio/ogg")).toBe("recording.ogg");
    expect(resolveAudioFilename("audio/wav")).toBe("recording.wav");
    expect(resolveAudioFilename("audio/webm;codecs=opus")).toBe("recording.webm");
  });
});

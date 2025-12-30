import { describe, expect, test } from "bun:test";

import { callModelStream } from "../api";

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
});

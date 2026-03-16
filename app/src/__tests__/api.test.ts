import { afterEach, describe, expect, test } from "bun:test";

import { callModelStream, exportDeck, importPptx, resolveAudioFilename, sendVoiceMessage } from "../api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("callModelStream", () => {
  test("handles CRLF SSE line endings", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      `data: "Hello"\r\n\r\n`,
      `data: [DONE]\r\n\r\n`,
    ];

    globalThis.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    let latest = "";
    const result = await callModelStream([], "", "auto", (html) => {
      latest = html;
    });

    expect(latest).toBe("Hello");
    expect(result.html).toBe("Hello");
  });

  test("extracts clarification text without leaking it into streamed html", async () => {
    const encoder = new TextEncoder();
    const snapshots: string[] = [];

    globalThis.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: "<clar"\n\n'));
          controller.enqueue(
            encoder.encode('data: "ify>Who is the audience?</clarify><div>Rendered</div>"\n\n')
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await callModelStream([], "", "auto", (html) => {
      snapshots.push(html);
    });

    expect(snapshots).toEqual(["", "<div>Rendered</div>"]);
    expect(result).toEqual({
      html: "<div>Rendered</div>",
      clarification: "Who is the audience?",
    });
  });

  test("throws SSE error frames as regular errors", async () => {
    const encoder = new TextEncoder();

    globalThis.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"error":"Model failed"}\n\n'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    try {
      await callModelStream([], "", "auto", () => {});
      throw new Error("Expected callModelStream to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Model failed");
    }
  });
});

describe("importPptx", () => {
  test("passes abort signals to import fetch", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | null = null;

    globalThis.fetch = (async (_url: string | URL | Request, options?: RequestInit) => {
      receivedSignal = (options?.signal as AbortSignal) || null;
      const stream = new ReadableStream<Uint8Array>({
        start(controllerStream) {
          controllerStream.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    const file = new File([new Uint8Array([1, 2, 3])], "test.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });
    await importPptx(file, () => {}, () => {}, { signal: controller.signal });
    expect(receivedSignal === controller.signal).toBe(true);
  });

  test("emits progress and slide callbacks from import events", async () => {
    const encoder = new TextEncoder();
    const progressEvents: string[] = [];
    const slides: Array<{ html: string; sourceType?: string }> = [];

    globalThis.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"progress","status":"Uploading"}\n\n'));
          controller.enqueue(
            encoder.encode(
              'data: {"type":"slide","index":0,"html":"<div>Slide 1</div>","source":{"background":{"type":"none"},"elements":[]}}\n\n'
            )
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    const file = new File([new Uint8Array([1, 2, 3])], "test.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });

    await importPptx(
      file,
      (progress) => {
        progressEvents.push(progress.type === "progress" ? progress.status || "" : progress.type);
      },
      (slide) => {
        slides.push({
          html: slide.html,
          sourceType: slide.source?.background.type,
        });
      }
    );

    expect(progressEvents).toEqual(["Uploading", "slide"]);
    expect(slides).toEqual([{ html: "<div>Slide 1</div>", sourceType: "none" }]);
  });

  test("resolves filenames for common audio types", () => {
    expect(resolveAudioFilename("audio/mpeg")).toBe("recording.mp3");
    expect(resolveAudioFilename("audio/mp4")).toBe("recording.mp4");
    expect(resolveAudioFilename("audio/ogg")).toBe("recording.ogg");
    expect(resolveAudioFilename("audio/wav")).toBe("recording.wav");
    expect(resolveAudioFilename("audio/webm;codecs=opus")).toBe("recording.webm");
  });
});

describe("sendVoiceMessage", () => {
  test("uploads audio and extracts clarification markup from the response", async () => {
    let formData: FormData | null = null;

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      formData = init?.body as FormData;
      return Response.json({
        html: "<div>Updated slide</div><clarify>Add customer segment</clarify>",
        transcription: "make this more concrete",
      });
    }) as unknown as typeof fetch;

    const result = await sendVoiceMessage(
      new Blob(["voice"], { type: "audio/ogg;codecs=opus" }),
      [{ role: "user", content: "Original prompt" }],
      "<div>Existing slide</div>",
      "auto"
    );

    expect(formData).not.toBeNull();
    expect(formData!.get("messages")).toBe('[{"role":"user","content":"Original prompt"}]');
    expect(formData!.get("currentHtml")).toBe("<div>Existing slide</div>");
    expect(formData!.get("model")).toBe("auto");
    expect((formData!.get("audio") as File).name).toBe("recording.ogg");
    expect(result).toEqual({
      html: "<div>Updated slide</div>",
      transcription: "make this more concrete",
      clarification: "Add customer segment",
    });
  });

  test("surfaces voice request failures", async () => {
    globalThis.fetch = (async () => {
      return new Response("Bad audio", { status: 400 });
    }) as unknown as typeof fetch;

    try {
      await sendVoiceMessage(new Blob(["voice"], { type: "audio/webm" }), [], "", "auto");
      throw new Error("Expected sendVoiceMessage to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe("Bad audio");
    }
  });
});

describe("exportDeck", () => {
  test("posts slides and returns the exported blob", async () => {
    const slides = [
      {
        id: "slide-1",
        html: "<div>Slide</div>",
      },
    ];
    let requestBody: unknown = null;

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      requestBody = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      return new Response(new Blob(["pptx-file"]), { status: 200 });
    }) as unknown as typeof fetch;

    const blob = await exportDeck(slides);

    expect(requestBody).toEqual({ slides });
    expect(await blob.text()).toBe("pptx-file");
  });
});

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect, useState } from "react";

import { useChatGeneration } from "../hooks/useChatGeneration";
import type { Message, Slide } from "../types";

const originalFetch = globalThis.fetch;

type HarnessSnapshot = {
  slides: Slide[];
  messages: Message[];
  hook: ReturnType<typeof useChatGeneration>;
};

function setStreamingFetch(chunks: string[]) {
  const encoder = new TextEncoder();
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
}

function createInitialSlides(): Slide[] {
  return [
    {
      id: "slide-0",
      html: "<div>Existing slide</div>",
      source: {
        background: { type: "none" },
        elements: [],
      },
    },
  ];
}

describe("useChatGeneration clarification handling", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    cleanup();
  });

  test("keeps the current slide when typed generation returns a clarification", async () => {
    setStreamingFetch([
      'data: "<clarify>Who is the audience for this slide?</clarify>"\n\n',
      "data: [DONE]\n\n",
    ]);

    let latest: HarnessSnapshot | null = null;

    function Harness() {
      const [slides, setSlides] = useState<Slide[]>(createInitialSlides);
      const [messages, setMessages] = useState<Message[]>([]);
      const hook = useChatGeneration({
        slides,
        currentSlideIndex: 0,
        messages,
        model: "auto",
        setSlides,
        setMessages,
      });

      useEffect(() => {
        latest = { slides, messages, hook };
      }, [slides, messages, hook]);

      return null;
    }

    render(<Harness />);

    await act(async () => {
      await latest!.hook.handleSend("Make this more specific");
    });

    expect(latest!.slides[0].html).toBe("<div>Existing slide</div>");
    expect(latest!.slides[0].source).toEqual({
      background: { type: "none" },
      elements: [],
    });
    expect(latest!.messages).toEqual([
      { role: "user", content: "Make this more specific" },
      { role: "assistant", content: "Who is the audience for this slide?" },
    ]);
  });

  test("keeps the current slide when voice generation returns a clarification", async () => {
    let latest: HarnessSnapshot | null = null;

    function Harness() {
      const [slides, setSlides] = useState<Slide[]>(createInitialSlides);
      const [messages, setMessages] = useState<Message[]>([]);
      const hook = useChatGeneration({
        slides,
        currentSlideIndex: 0,
        messages,
        model: "auto",
        setSlides,
        setMessages,
      });

      useEffect(() => {
        latest = { slides, messages, hook };
      }, [slides, messages, hook]);

      return null;
    }

    render(<Harness />);

    await act(async () => {
      latest!.hook.handleVoiceMessage(
        "Turn this into a customer pitch",
        "",
        "Which customer segment should the pitch target?"
      );
    });

    expect(latest!.slides[0].html).toBe("<div>Existing slide</div>");
    expect(latest!.slides[0].source).toEqual({
      background: { type: "none" },
      elements: [],
    });
    expect(latest!.messages).toEqual([
      { role: "user", content: "Turn this into a customer pitch" },
      { role: "assistant", content: "Which customer segment should the pitch target?" },
    ]);
  });
});

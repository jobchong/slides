import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";

import { useImportExport } from "../hooks/useImportExport";
import type { Slide } from "../types";

const originalFetch = globalThis.fetch;

type HarnessSnapshot = {
  slides: Slide[];
  currentSlideIndex: number;
  messages: [];
  hook: ReturnType<typeof useImportExport>;
};

function createInitialSlides(): Slide[] {
  return [
    {
      id: "slide-0",
      html: "",
      source: {
        background: { type: "none" },
        elements: [],
      },
    },
  ];
}

describe("useImportExport", () => {
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

  test("surfaces mid-stream import errors as durable hook errors", async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"type":"progress","status":"Importing..."}\n\n')
          );
          controller.enqueue(
            encoder.encode('data: {"type":"error","error":"Import failed halfway"}\n\n')
          );
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    }) as unknown as typeof fetch;

    let latest: HarnessSnapshot | null = null;

    function Harness() {
      const [slides, setSlides] = useState<Slide[]>(createInitialSlides);
      const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
      const [messages, setMessages] = useState<[]>([]);
      const hook = useImportExport({
        slides,
        setSlides,
        setCurrentSlideIndex,
        setMessages,
      });

      useEffect(() => {
        latest = { slides, currentSlideIndex, messages, hook };
      }, [slides, currentSlideIndex, messages, hook]);

      return null;
    }

    render(<Harness />);

    const file = new File([new Uint8Array([1, 2, 3])], "test.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    });

    await act(async () => {
      await latest!.hook.handleFileSelect({
        target: { files: [file], value: "test.pptx" },
      } as unknown as React.ChangeEvent<HTMLInputElement>);
    });

    await waitFor(() => {
      expect(latest).not.toBeNull();
      expect(latest!.hook.isImporting).toBe(false);
      expect(latest!.hook.importProgress).toBeNull();
      expect(latest!.hook.importExportError).toBe("Import failed halfway");
    });
  });
});

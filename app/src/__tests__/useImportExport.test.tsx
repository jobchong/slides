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

function createPopulatedSlides(): Slide[] {
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

  test("clicks the file input when import is requested", async () => {
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

      return <input ref={hook.fileInputRef} type="file" />;
    }

    const { container } = render(<Harness />);

    await waitFor(() => {
      expect(latest).not.toBeNull();
    });

    const input = container.querySelector("input");
    expect(input).not.toBeNull();

    let clickCount = 0;
    input!.click = () => {
      clickCount += 1;
    };

    act(() => {
      latest!.hook.handleImportClick();
    });

    expect(clickCount).toBe(1);
  });

  test("replaces the empty placeholder slide with sanitized imported content", async () => {
    const encoder = new TextEncoder();
    globalThis.fetch = (async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"type":"progress","status":"Reading file"}\n\n'));
          controller.enqueue(
            encoder.encode(
              'data: {"type":"slide","index":0,"html":"<div onclick=\\"alert(1)\\"><script>bad()</script>Imported slide</div>","source":{"background":{"type":"none"},"elements":[]}}\n\n'
            )
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

    await waitFor(() => {
      expect(latest).not.toBeNull();
    });

    const event = {
      target: { files: [new File(["pptx"], "deck.pptx")], value: "deck.pptx" },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    await act(async () => {
      await latest!.hook.handleFileSelect(event);
    });

    expect(event.target.value).toBe("");
    expect(latest!.slides).toHaveLength(1);
    expect(latest!.slides[0]?.html).toContain("Imported slide");
    expect(latest!.slides[0]?.html).not.toContain("script");
    expect(latest!.slides[0]?.html).not.toContain("onclick");
    expect(latest!.currentSlideIndex).toBe(0);
    expect(latest!.hook.isImporting).toBe(false);
    expect(latest!.hook.importProgress).toBeNull();
    expect(latest!.hook.importExportError).toBeNull();
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

  test("aborts an in-flight import without surfacing an error", async () => {
    let abortCount = 0;

    globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        const signal = init?.signal;
        signal?.addEventListener(
          "abort",
          () => {
            abortCount += 1;
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true }
        );
      });
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

    await waitFor(() => {
      expect(latest).not.toBeNull();
    });

    const importPromise = latest!.hook.handleFileSelect({
      target: { files: [new File(["pptx"], "deck.pptx")], value: "deck.pptx" },
    } as unknown as React.ChangeEvent<HTMLInputElement>);

    await waitFor(() => {
      expect(latest!.hook.isImporting).toBe(true);
    });

    act(() => {
      latest!.hook.handleImportCancel();
    });

    await act(async () => {
      await importPromise;
    });

    expect(abortCount).toBe(1);
    expect(latest!.hook.isImporting).toBe(false);
    expect(latest!.hook.importProgress).toBeNull();
    expect(latest!.hook.importExportError).toBeNull();
  });

  test("exports the current deck through a downloadable blob link", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;

    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    let clickedHref = "";
    let clickedDownload = "";
    const revokedUrls: string[] = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        url: typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url,
        method: init?.method || "GET",
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      return new Response(new Blob(["pptx"]), { status: 200 });
    }) as unknown as typeof fetch;

    Object.defineProperty(URL, "createObjectURL", {
      value: () => "blob:deck-export",
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: (url: string) => {
        revokedUrls.push(url);
      },
      configurable: true,
      writable: true,
    });
    HTMLAnchorElement.prototype.click = function click() {
      clickedHref = this.href;
      clickedDownload = this.download;
    };

    let latest: HarnessSnapshot | null = null;

    function Harness() {
      const [slides, setSlides] = useState<Slide[]>(createPopulatedSlides);
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

    try {
      render(<Harness />);

      await waitFor(() => {
        expect(latest).not.toBeNull();
      });

      await act(async () => {
        await latest!.hook.handleExportClick();
      });

      expect(requests).toEqual([
        {
          url: "http://localhost:4000/api/export",
          method: "POST",
          body: { slides: createPopulatedSlides() },
        },
      ]);
      expect(clickedHref).toBe("blob:deck-export");
      expect(clickedDownload).toBe("slides.pptx");
      expect(revokedUrls).toEqual(["blob:deck-export"]);
      expect(latest!.hook.isExporting).toBe(false);
      expect(latest!.hook.importExportError).toBeNull();
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        value: originalCreateObjectURL,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        value: originalRevokeObjectURL,
        configurable: true,
        writable: true,
      });
      HTMLAnchorElement.prototype.click = originalAnchorClick;
    }
  });

  test("captures export errors and clears them on demand", async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: "Export exploded" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    let latest: HarnessSnapshot | null = null;

    function Harness() {
      const [slides, setSlides] = useState<Slide[]>(createPopulatedSlides);
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

    await waitFor(() => {
      expect(latest).not.toBeNull();
    });

    await act(async () => {
      await latest!.hook.handleExportClick();
    });

    expect(latest!.hook.importExportError).toBe("Export exploded");

    act(() => {
      latest!.hook.clearImportExportError();
    });

    expect(latest!.hook.importExportError).toBeNull();
  });
});

import { afterEach, describe, expect, test } from "bun:test";

import type { Slide } from "../../app/src/types";
import { exportDeckToPptx, InvalidExportAssetUrlError } from "../export";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0NsAAAAASUVORK5CYII=",
  "base64"
);

const originalFetch = globalThis.fetch;
const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
const originalS3PublicBaseUrl = process.env.S3_PUBLIC_BASE_URL;

function setFetch(handler: (input: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    return handler(url);
  }) as typeof fetch;
}

function makeImageSlide(url: string): Slide {
  return {
    id: "slide-0",
    html: "",
    source: {
      background: { type: "none" },
      elements: [
        {
          id: "image-0",
          type: "image",
          bounds: { x: 10, y: 10, width: 30, height: 30 },
          zIndex: 0,
          image: {
            url,
            objectFit: "fill",
          },
        },
      ],
    },
  };
}

function makeBackgroundSlide(url: string): Slide {
  return {
    id: "slide-0",
    html: "",
    source: {
      background: { type: "image", url },
      elements: [],
    },
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;

  if (originalPublicBaseUrl === undefined) {
    delete process.env.PUBLIC_BASE_URL;
  } else {
    process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
  }

  if (originalS3PublicBaseUrl === undefined) {
    delete process.env.S3_PUBLIC_BASE_URL;
  } else {
    process.env.S3_PUBLIC_BASE_URL = originalS3PublicBaseUrl;
  }
});

describe("export asset URL validation", () => {
  test("rewrites relative upload URLs to the configured export gateway", async () => {
    let fetchedUrl = "";
    setFetch((input) => {
      fetchedUrl = input;
      return new Response(ONE_PIXEL_PNG, {
        headers: { "Content-Type": "image/png" },
      });
    });

    await exportDeckToPptx([makeImageSlide("/images/example.png")], {
      gatewayBaseUrl: "http://127.0.0.1:4000",
      requestBaseUrl: "https://slides.example.com",
    });

    expect(fetchedUrl).toBe("http://127.0.0.1:4000/images/example.png");
  });

  test("rewrites absolute same-origin upload URLs to the configured export gateway", async () => {
    let fetchedUrl = "";
    setFetch((input) => {
      fetchedUrl = input;
      return new Response(ONE_PIXEL_PNG, {
        headers: { "Content-Type": "image/png" },
      });
    });

    await exportDeckToPptx([makeImageSlide("https://slides.example.com/images/example.png")], {
      gatewayBaseUrl: "http://127.0.0.1:4000",
      requestBaseUrl: "https://slides.example.com",
    });

    expect(fetchedUrl).toBe("http://127.0.0.1:4000/images/example.png");
  });

  test("allows configured public upload bases", async () => {
    process.env.S3_PUBLIC_BASE_URL = "https://cdn.example.com/uploads";

    let fetchedUrl = "";
    setFetch((input) => {
      fetchedUrl = input;
      return new Response(ONE_PIXEL_PNG, {
        headers: { "Content-Type": "image/png" },
      });
    });

    await exportDeckToPptx(
      [makeBackgroundSlide("https://cdn.example.com/uploads/example.png")],
      {
        gatewayBaseUrl: "http://127.0.0.1:4000",
        requestBaseUrl: "https://slides.example.com",
      }
    );

    expect(fetchedUrl).toBe("https://cdn.example.com/uploads/example.png");
  });

  test("rejects arbitrary remote asset URLs before any fetch", async () => {
    let fetchCalls = 0;
    setFetch(() => {
      fetchCalls += 1;
      return new Response(ONE_PIXEL_PNG, {
        headers: { "Content-Type": "image/png" },
      });
    });

    await expect(
      exportDeckToPptx([makeImageSlide("http://169.254.169.254/latest/meta-data")], {
        gatewayBaseUrl: "http://127.0.0.1:4000",
        requestBaseUrl: "https://slides.example.com",
      })
    ).rejects.toBeInstanceOf(InvalidExportAssetUrlError);

    expect(fetchCalls).toBe(0);
  });
});

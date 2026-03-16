import { afterEach, describe, expect, test } from "bun:test";

import { inlineHtmlExportAssetUrls, InvalidExportAssetUrlError } from "../export";

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Z0NsAAAAASUVORK5CYII=",
  "base64"
);

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("inlineHtmlExportAssetUrls", () => {
  test("inlines upload images and background URLs for rasterized html slides", async () => {
    const fetchCalls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      fetchCalls.push(url);
      return new Response(ONE_PIXEL_PNG, {
        headers: { "Content-Type": "image/png" },
      });
    }) as unknown as typeof fetch;

    const html = `
      <img src="/images/example.png" alt="Example" />
      <div style="background-image: url('https://slides.example.com/images/bg.png'); mask-image: url(#mask);"></div>
    `;

    const result = await inlineHtmlExportAssetUrls(html, {
      gatewayBaseUrl: "http://127.0.0.1:4000",
      requestBaseUrl: "https://slides.example.com",
    });

    expect(fetchCalls).toEqual([
      "http://127.0.0.1:4000/images/example.png",
      "http://127.0.0.1:4000/images/bg.png",
    ]);
    expect(result).toContain('src="data:image/png;base64,');
    expect(result).toContain("background-image: url('data:image/png;base64,");
    expect(result).toContain("mask-image: url(#mask)");
  });

  test("inlines public remote images for html slides", async () => {
    const fetchCalls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      fetchCalls.push(url);
      return new Response(ONE_PIXEL_PNG, {
        headers: { "Content-Type": "image/png" },
      });
    }) as unknown as typeof fetch;

    const result = await inlineHtmlExportAssetUrls(
      '<img src="https://93.184.216.34/example.png" alt="Remote" />',
      {
        gatewayBaseUrl: "http://127.0.0.1:4000",
        requestBaseUrl: "https://slides.example.com",
      }
    );

    expect(fetchCalls).toEqual(["https://93.184.216.34/example.png"]);
    expect(result).toContain('src="data:image/png;base64,');
  });

  test("rejects private remote images before fetch", async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(ONE_PIXEL_PNG, {
        headers: { "Content-Type": "image/png" },
      });
    }) as unknown as typeof fetch;

    await expect(
      inlineHtmlExportAssetUrls(
        '<img src="http://169.254.169.254/latest/meta-data" alt="Blocked" />',
        {
          gatewayBaseUrl: "http://127.0.0.1:4000",
          requestBaseUrl: "https://slides.example.com",
        }
      )
    ).rejects.toBeInstanceOf(InvalidExportAssetUrlError);

    expect(fetchCalls).toBe(0);
  });
});

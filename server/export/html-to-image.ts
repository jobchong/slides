import { chromium } from "playwright";

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 720;

function wrapHtml(content: string, width: number, height: number, background?: string): string {
  const safeBackground = background || "#ffffff";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
        background: ${safeBackground};
      }
      .slide {
        width: ${width}px;
        height: ${height}px;
        position: relative;
        overflow: hidden;
        background: ${safeBackground};
      }
    </style>
  </head>
  <body>
    <div class="slide">
      ${content}
    </div>
  </body>
</html>`;
}

export async function renderHtmlToPng(
  html: string,
  options?: { width?: number; height?: number; background?: string }
): Promise<Buffer> {
  const width = options?.width ?? DEFAULT_WIDTH;
  const height = options?.height ?? DEFAULT_HEIGHT;
  const background = options?.background;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      javaScriptEnabled: false,
    });
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url === "about:blank") {
        return route.continue();
      }
      return route.abort();
    });
    const content = wrapHtml(html, width, height, background);
    await page.setContent(content, { waitUntil: "domcontentloaded" });
    const buffer = await page.screenshot({ type: "png" });
    await context.close();
    return buffer as Buffer;
  } finally {
    await browser.close();
  }
}

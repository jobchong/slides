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
    const page = await browser.newPage({ viewport: { width, height } });
    const content = wrapHtml(html, width, height, background);
    await page.setContent(content, { waitUntil: "load" });
    const buffer = await page.screenshot({ type: "png" });
    return buffer as Buffer;
  } finally {
    await browser.close();
  }
}

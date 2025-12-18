import type { ExtractedSlide } from "./types";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildRasterSlideHtml(
  slideImageUrl: string,
  slide: ExtractedSlide
): string {
  // Use the raster as the only visible content; keep extracted text invisible for semantic context.
  const invisibleText = slide.elements
    .filter((e) => e.type === "text" && e.text)
    .map((e) => {
      const text = e.text!.paragraphs
        .flatMap((p) => p.runs.map((r) => r.text))
        .join("\n");
      const original = escapeHtml(text);
      const style = [
        "position:absolute",
        `left:${e.bounds.x.toFixed(4)}%`,
        `top:${e.bounds.y.toFixed(4)}%`,
        `width:${e.bounds.width.toFixed(4)}%`,
        `height:${e.bounds.height.toFixed(4)}%`,
        "opacity:0",
        "pointer-events:none",
        "white-space:pre-wrap",
      ].join(";");

      // Provide a hidden "mask" layer that can be turned on to cover the original raster text.
      // The LLM can set the mask opacity to 1 and the text opacity to 1 when editing.
      const maskStyle = [
        "position:absolute",
        `left:${e.bounds.x.toFixed(4)}%`,
        `top:${e.bounds.y.toFixed(4)}%`,
        `width:${e.bounds.width.toFixed(4)}%`,
        `height:${e.bounds.height.toFixed(4)}%`,
        "opacity:0",
        "pointer-events:none",
        "background:rgba(255,255,255,0.92)",
      ].join(";");

      return `<div data-import-role="mask" data-import-for="text" style="${maskStyle}"></div>
<div data-import-role="text" data-original-text="${original}" style="${style}">${original}</div>`;
    })
    .join("\n");

  return `<div data-import="pptx-raster" style="position:relative;width:100%;height:100%;overflow:hidden;">
  <img data-import-role="background" src="${escapeHtml(slideImageUrl)}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;" />
  ${invisibleText}
</div>`;
}

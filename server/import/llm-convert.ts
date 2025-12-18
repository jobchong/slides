// Vision-based slide conversion using Claude's vision API

import Anthropic from "@anthropic-ai/sdk";
import type { EditableElement, Theme, SlideBackground } from "./types";
import { buildConversionSystemPrompt } from "./prompt";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    const apiKey =
      process.env.MODEL_API_KEY ||
      process.env.VITE_MODEL_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.VITE_ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY or MODEL_API_KEY not set");
    }

    anthropicClient = new Anthropic({ apiKey });
  }
  return anthropicClient;
}

function formatBackground(background: SlideBackground): string {
  switch (background.type) {
    case "solid":
      return `Solid color: ${background.color}`;
    case "gradient":
      const stops = background.stops
        .map((s) => `${s.color} at ${s.position}%`)
        .join(", ");
      return `Gradient at ${background.angle}deg: ${stops}`;
    case "image":
      return `Image: ${background.url}`;
    case "rasterized":
      return `Rasterized background (visible in screenshot)`;
    case "none":
      return "None (use white)";
  }
}

function formatElement(element: EditableElement): string {
  const lines: string[] = [];
  lines.push(`### ${element.type.toUpperCase()} (id: ${element.id})`);
  lines.push(
    `- Position: left ${element.bounds.x.toFixed(1)}%, top ${element.bounds.y.toFixed(1)}%`
  );
  lines.push(
    `- Size: ${element.bounds.width.toFixed(1)}% × ${element.bounds.height.toFixed(1)}%`
  );
  lines.push(`- Z-index: ${element.zIndex}`);

  if (element.rotation) {
    lines.push(`- Rotation: ${element.rotation}deg`);
  }

  if (element.text) {
    const style = element.text.style;
    const preview = element.text.content.slice(0, 200);
    const truncated = element.text.content.length > 200 ? "..." : "";
    lines.push(`- Content: "${preview}${truncated}"`);
    lines.push(
      `- Font: ${style.fontFamily}, ${style.fontSize}px, weight ${style.fontWeight}`
    );
    lines.push(`- Color: ${style.color}`);
    lines.push(`- Align: ${style.align}`);
  }

  if (element.image) {
    lines.push(`- URL: ${element.image.url}`);
    lines.push(`- Fit: ${element.image.objectFit}`);
  }

  if (element.shape) {
    lines.push(`- Shape: ${element.shape.kind}`);
    lines.push(`- Fill: ${element.shape.fill}`);
    if (element.shape.stroke) {
      lines.push(
        `- Stroke: ${element.shape.stroke} ${element.shape.strokeWidth || 1}px`
      );
    }
  }

  return lines.join("\n");
}

function buildUserPrompt(
  elements: EditableElement[],
  theme: Theme,
  background: SlideBackground
): string {
  const sections: string[] = [];

  sections.push(
    "Convert this slide to editable HTML. Match the screenshot exactly.\n"
  );

  sections.push("## Theme");
  sections.push(`- Title font: ${theme.fonts.majorLatin}`);
  sections.push(`- Body font: ${theme.fonts.minorLatin}`);
  sections.push(`- Dark color: ${theme.colors.dk1}`);
  sections.push(`- Light color: ${theme.colors.lt1}`);
  sections.push(`- Accent: ${theme.colors.accent1}`);
  sections.push("");

  sections.push("## Background");
  sections.push(formatBackground(background));
  sections.push("");

  sections.push("## Elements");
  if (elements.length === 0) {
    sections.push("No foreground elements extracted. Recreate from screenshot.");
  } else {
    sections.push(
      "Use these exact positions and text content. Match styling from screenshot:\n"
    );
    for (const element of elements) {
      sections.push(formatElement(element));
      sections.push("");
    }
  }

  sections.push("## Output");
  sections.push("Generate the HTML now. Output ONLY raw HTML, no markdown.");

  return sections.join("\n");
}

/**
 * Convert a slide to HTML using Claude's vision API.
 * The screenshot provides visual reference, elements provide exact data.
 */
export async function convertSlideWithVision(
  screenshotBase64: string,
  elements: EditableElement[],
  theme: Theme,
  background: SlideBackground,
  model = DEFAULT_MODEL
): Promise<string> {
  const client = getAnthropicClient();

  const systemPrompt = buildConversionSystemPrompt();
  const userPrompt = buildUserPrompt(elements, theme, background);

  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: screenshotBase64,
            },
          },
          {
            type: "text",
            text: userPrompt,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  const html = textBlock?.text ?? "";

  // Strip any markdown code fences if present
  return html
    .replace(/^```html?\n?/i, "")
    .replace(/\n?```$/i, "")
    .trim();
}

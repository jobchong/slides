// Prompt Builder - Creates structured prompts for LLM conversion

import type {
  SlideSource,
  PreparedSlide,
  EditableElement,
  SlideBackground,
  Theme,
} from "./types";

/**
 * Build the system prompt for slide conversion
 */
export function buildConversionSystemPrompt(): string {
  return `You are converting imported presentation slides to editable HTML.

## Your Task
Generate HTML that:
1. Visually matches the screenshot reference exactly
2. Uses the structured element data for precise positioning
3. Produces editable, semantic HTML (not rasterized images)

## Output Format
- Raw HTML only, no markdown code fences, no explanations
- Use a single container div with position: relative and 100% width/height
- Use position: absolute on all elements with percentage-based coordinates (left, top, width, height as %)
- Use px for font-size only
- NEVER use vw, vh, vmin, or vmax units - only percentages and px
- Add data-element-id attribute to each element for editability

## Element Guidelines

### Text Elements
- Use <div> with appropriate styling
- Preserve font family, size, weight, color exactly
- Match alignment and vertical positioning
- For multi-line text, use white-space: pre-wrap

### Images
- Use <img> tags with the provided URLs
- Apply object-fit as specified

### Shapes
- Simple shapes: Use CSS (border-radius, background, borders)
- Ellipse: border-radius: 50%
- RoundRect: border-radius: 8px (or as specified)

### Background
- If type is 'rasterized': Use as full-bleed background image with z-index: 0
- If type is 'solid': Apply as CSS background color
- If type is 'gradient': Apply as CSS linear-gradient

## Quality Standards
- Typography must match the original exactly
- Colors must be exact hex matches
- Spacing and alignment must be precise
- Z-index ordering must match the source`;
}

/**
 * Format background for prompt
 */
function formatBackground(background: SlideBackground): string {
  switch (background.type) {
    case "solid":
      return `Solid color: ${background.color}`;
    case "gradient":
      const stops = background.stops.map(s => `${s.color} at ${s.position}%`).join(", ");
      return `Gradient at ${background.angle}deg: ${stops}`;
    case "image":
      return `Image: ${background.url}`;
    case "rasterized":
      return `Rasterized background image: ${background.url}`;
    case "none":
      return "None (use white)";
  }
}

/**
 * Format an element for the prompt
 */
function formatElement(element: EditableElement): string {
  const lines: string[] = [];
  lines.push(`### ${element.type.toUpperCase()} (id: ${element.id})`);
  lines.push(`- Position: ${element.bounds.x.toFixed(2)}%, ${element.bounds.y.toFixed(2)}%`);
  lines.push(`- Size: ${element.bounds.width.toFixed(2)}% x ${element.bounds.height.toFixed(2)}%`);
  lines.push(`- Z-index: ${element.zIndex}`);

  if (element.rotation) {
    lines.push(`- Rotation: ${element.rotation}deg`);
  }

  if (element.text) {
    const style = element.text.style;
    lines.push(`- Content: "${element.text.content.slice(0, 100)}${element.text.content.length > 100 ? "..." : ""}"`);
    lines.push(`- Font: ${style.fontFamily} ${style.fontSize}px ${style.fontWeight}`);
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
      lines.push(`- Stroke: ${element.shape.stroke} ${element.shape.strokeWidth || 1}px`);
    }
    if (element.shape.borderRadius) {
      lines.push(`- Border radius: ${element.shape.borderRadius}px`);
    }
  }

  return lines.join("\n");
}

/**
 * Build the user prompt for slide conversion
 */
export function buildConversionPrompt(prepared: PreparedSlide): string {
  const sections: string[] = [];

  sections.push("Convert this slide to editable HTML.\n");

  // Theme info
  sections.push("## Theme");
  sections.push(`- Primary font: ${prepared.theme.fonts.majorLatin}`);
  sections.push(`- Body font: ${prepared.theme.fonts.minorLatin}`);
  sections.push(`- Dark color: ${prepared.theme.colors.dk1}`);
  sections.push(`- Light color: ${prepared.theme.colors.lt1}`);
  sections.push(`- Accent: ${prepared.theme.colors.accent1}`);
  sections.push("");

  // Background
  sections.push("## Background");
  sections.push(formatBackground(prepared.background));
  sections.push("");

  // Elements
  sections.push("## Elements");
  if (prepared.elements.length === 0) {
    sections.push("No foreground elements.");
  } else {
    for (const element of prepared.elements) {
      sections.push(formatElement(element));
      sections.push("");
    }
  }

  sections.push("Generate the HTML now.");

  return sections.join("\n");
}

/**
 * Build prompt for editing an existing slide
 */
export function buildEditPrompt(
  source: SlideSource,
  currentHtml: string,
  userRequest: string,
  theme: Theme
): string {
  const sections: string[] = [];

  sections.push("Edit this slide based on the user request.\n");

  sections.push("## User Request");
  sections.push(userRequest);
  sections.push("");

  sections.push("## Current Slide Structure");
  sections.push("### Background");
  sections.push(formatBackground(source.background));
  sections.push("");

  sections.push("### Elements");
  for (const element of source.elements) {
    sections.push(formatElement(element));
    sections.push("");
  }

  sections.push("## Current HTML");
  sections.push("```html");
  sections.push(currentHtml);
  sections.push("```");
  sections.push("");

  sections.push("## Instructions");
  sections.push("1. Identify which elements need to be modified based on the user request");
  sections.push("2. Update the HTML to reflect the changes");
  sections.push("3. Preserve all other elements unchanged");
  sections.push("4. Keep all data-element-id attributes");
  sections.push("5. Output only the complete updated HTML, no explanations");
  sections.push("");

  sections.push("Generate the updated HTML now.");

  return sections.join("\n");
}

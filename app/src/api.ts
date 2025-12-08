import type { Message } from "./types";

const SYSTEM_PROMPT = `You are a slide design assistant. You output HTML that will be rendered inside a 16:9 slide container.

When the user describes what they want, output ONLY the HTML content for the slide. No explanation, no markdown code fences, just raw HTML.

The slide container has position: relative, so use position: absolute on elements with percentage-based top/left/right/bottom for positioning.

## Guidelines

Positioning:
- Use position: absolute on all elements
- Use percentages for top/left/right/bottom (e.g., top: 10%, left: 5%)
- Center elements: top: 50%, left: 50%, transform: translate(-50%, -50%)

Sizing:
- Use px for width/height and font-size
- Common font sizes: 14, 16, 18, 24, 32, 48, 64, 80px

Shapes:
- Use div elements with background-color
- Circles: border-radius: 50%
- Include width and height

Text:
- Use div elements
- font-weight: 400 (normal), 600 (semibold), 700 (bold)

Colors:
- Use hex values: #ffffff, #1a1a2e
- For transparency: rgba(0, 0, 0, 0.5)

## Example output

<div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 64px; font-weight: 700; color: #1a1a2e;">
  Hello World
</div>
<div style="position: absolute; top: 5%; right: 5%; width: 80px; height: 80px; border-radius: 50%; background-color: #e94560;">
</div>

## Important

- Output the COMPLETE slide HTML each time (all elements, not just changes)
- When user says "make it bigger" or "change the color", output the full updated HTML
- Maintain all existing elements unless told to remove them
- No markdown, no code fences, no explanations - just HTML`;

export async function callClaude(
  messages: Message[],
  currentHtml: string
): Promise<string> {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("VITE_ANTHROPIC_API_KEY not set");
  }

  // Build messages with current HTML state
  const claudeMessages = messages.map((m, i) => {
    if (m.role === "user" && i === messages.length - 1) {
      const stateContext = currentHtml
        ? `Current slide HTML:\n${currentHtml}\n\nUser request: ${m.content}`
        : m.content;
      return { role: "user" as const, content: stateContext };
    }
    return { role: m.role as "user" | "assistant", content: m.content };
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: claudeMessages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error: ${error}`);
  }

  const data = await response.json();

  // Extract text content
  const textBlock = data.content.find((block: { type: string }) => block.type === "text");
  return textBlock?.text ?? "";
}

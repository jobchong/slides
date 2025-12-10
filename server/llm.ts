interface Message {
  role: "user" | "assistant";
  content: string;
}

type Provider = "anthropic" | "openai";

const DEFAULT_MODEL =
  process.env.DEFAULT_MODEL ||
  process.env.VITE_DEFAULT_MODEL ||
  "claude-sonnet-4-5-20250929";

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

function withStateContext(
  messages: Message[],
  currentHtml: string
): Message[] {
  return messages.map((m, i) => {
    if (m.role === "user" && i === messages.length - 1) {
      const stateContext = currentHtml
        ? `Current slide HTML:\n${currentHtml}\n\nUser request: ${m.content}`
        : m.content;
      return { role: "user" as const, content: stateContext };
    }
    return { role: m.role as "user" | "assistant", content: m.content };
  });
}

function inferProvider(model: string): Provider {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt")) return "openai";
  throw new Error(`Unsupported model "${model}". Expected claude* or gpt*.`);
}

function resolveApiKey(provider: Provider) {
  const genericKey = process.env.MODEL_API_KEY || process.env.VITE_MODEL_API_KEY;
  if (provider === "anthropic") {
    return (
      genericKey ||
      process.env.ANTHROPIC_API_KEY ||
      process.env.VITE_ANTHROPIC_API_KEY
    );
  }
  return genericKey || process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
}

async function callAnthropic(
  model: string,
  messages: Message[],
  currentHtml: string
): Promise<string> {
  const apiKey = resolveApiKey("anthropic");
  if (!apiKey) {
    throw new Error("MODEL_API_KEY (or ANTHROPIC_API_KEY) not set");
  }

  const claudeMessages = withStateContext(messages, currentHtml);
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: claudeMessages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Anthropic error: ${error}`);
  }

  const data = await response.json();
  const textBlock = data.content.find(
    (block: { type: string }) => block.type === "text"
  );
  return textBlock?.text ?? "";
}

async function callOpenAI(
  model: string,
  messages: Message[],
  currentHtml: string
): Promise<string> {
  const apiKey = resolveApiKey("openai");
  if (!apiKey) {
    throw new Error("MODEL_API_KEY (or OPENAI_API_KEY) not set");
  }

  const withContext = withStateContext(messages, currentHtml);
  const openAiMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...withContext,
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: 4096,
      messages: openAiMessages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI error: ${error}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  return content || "";
}

export async function generateSlide(
  messages: Message[],
  currentHtml: string,
  model = DEFAULT_MODEL
): Promise<string> {
  const provider = inferProvider(model);
  if (provider === "anthropic") {
    return callAnthropic(model, messages, currentHtml);
  }
  return callOpenAI(model, messages, currentHtml);
}

export function getDefaultModel() {
  return DEFAULT_MODEL;
}

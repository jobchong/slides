import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

interface Message {
  role: "user" | "assistant";
  content: string;
}

type Provider = "anthropic" | "openai" | "google";

const DEFAULT_MODEL =
  process.env.DEFAULT_MODEL ||
  process.env.VITE_DEFAULT_MODEL ||
  "claude-haiku-4-5-20251015";

const MAX_GENERATION_TOKENS = 4096;

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
  if (model.startsWith("models/gemini")) return "google";
  throw new Error(`Unsupported model "${model}". Expected claude*, gpt*, or gemini*.`);
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
  if (provider === "google") {
    return (
      genericKey ||
      process.env.GOOGLE_API_KEY ||
      process.env.VITE_GOOGLE_API_KEY
    );
  }
  return genericKey || process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY;
}

function requireApiKey(provider: Provider): string {
  const key = resolveApiKey(provider);
  if (!key) {
    const providerLabels: Record<Provider, string> = {
      anthropic: "ANTHROPIC",
      openai: "OPENAI",
      google: "GOOGLE",
    };
    throw new Error(`MODEL_API_KEY (or ${providerLabels[provider]}_API_KEY) not set`);
  }
  return key;
}

let anthropicClient: Anthropic | null = null;
function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: requireApiKey("anthropic") });
  }
  return anthropicClient;
}

let openAIClient: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (!openAIClient) {
    openAIClient = new OpenAI({ apiKey: requireApiKey("openai") });
  }
  return openAIClient;
}

let googleClient: GoogleGenAI | null = null;
function getGoogleClient(): GoogleGenAI {
  if (!googleClient) {
    googleClient = new GoogleGenAI({ apiKey: requireApiKey("google") });
  }
  return googleClient;
}

function buildOpenAIMessages(messages: Message[]): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];
}

function flattenOpenAIContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!content || !Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: string | null }).text;
        return text || "";
      }
      return "";
    })
    .join("");
}

async function callAnthropic(
  model: string,
  messages: Message[],
  currentHtml: string
): Promise<string> {
  const claudeMessages = withStateContext(messages, currentHtml);
  const response = await getAnthropicClient().messages.create({
    model,
    max_tokens: MAX_GENERATION_TOKENS,
    system: SYSTEM_PROMPT,
    messages: claudeMessages,
  });

  const textBlock = response.content.find(
    (block) => block.type === "text"
  );
  return textBlock?.text ?? "";
}

async function callOpenAI(
  model: string,
  messages: Message[],
  currentHtml: string
): Promise<string> {
  const openAiMessages = buildOpenAIMessages(
    withStateContext(messages, currentHtml)
  );
  const response = await getOpenAIClient().chat.completions.create({
    model,
    max_completion_tokens: MAX_GENERATION_TOKENS,
    messages: openAiMessages,
  });

  return flattenOpenAIContent(response.choices?.[0]?.message?.content);
}

async function callGoogle(
  model: string,
  messages: Message[],
  currentHtml: string
): Promise<string> {
  const contextMessages = withStateContext(messages, currentHtml);
  const contents = contextMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const response = await getGoogleClient().models.generateContent({
    model,
    contents,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      maxOutputTokens: MAX_GENERATION_TOKENS,
    },
  });

  return response.text ?? "";
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
  if (provider === "google") {
    return callGoogle(model, messages, currentHtml);
  }
  return callOpenAI(model, messages, currentHtml);
}

export function getDefaultModel() {
  return DEFAULT_MODEL;
}

import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { DiagramIntent } from "../app/src/types";

interface Message {
  role: "user" | "assistant";
  content: string;
}

type Provider = "anthropic" | "openai" | "google";

const DEFAULT_MODEL =
  process.env.DEFAULT_MODEL ||
  process.env.VITE_DEFAULT_MODEL ||
  "claude-haiku-4-5-20251001";

const COMPLEX_MODEL = "claude-sonnet-4-5-20250929";
const SIMPLE_MODEL = "claude-haiku-4-5-20251001";
const COMPLEXITY_THRESHOLD = 4;

const MAX_GENERATION_TOKENS = 4096;

/**
 * Scores the complexity of a slide generation request.
 * Higher scores indicate more complex requests that benefit from a stronger model.
 */
function scoreComplexity(message: string): number {
  let score = 0;

  // Multiple elements (weighted heavily)
  if (/\d+\s*(box|rect|circle|item|step|node|shape)/i.test(message)) score += 3;
  if (/\b(several|multiple|many|few)\b/i.test(message)) score += 2;

  // Spatial relationships
  if (/\b(next to|beside|below|above|between|left of|right of|connect|chain|link|arrange)\b/i.test(message)) score += 2;

  // Diagram types
  if (/\b(diagram|flowchart|chart|timeline|hierarchy|org\s*chart|process|workflow|pipeline)\b/i.test(message)) score += 3;

  // Arrows/connectors
  if (/\b(arrow|connector|line|point(s|ing)?\s*(to|at)|leads?\s*to)\b/i.test(message)) score += 2;

  // Complex layouts
  if (/\b(grid|column|row|layout|align|distribute|evenly\s*spaced)\b/i.test(message)) score += 2;

  // Long/detailed requests tend to be complex
  const wordCount = message.split(/\s+/).length;
  if (wordCount > 30) score += 2;
  else if (wordCount > 20) score += 1;

  return score;
}

/**
 * Selects the appropriate model based on request complexity.
 * Returns the user's explicit choice if provided, otherwise auto-routes.
 */
export function selectModel(message: string, userModel?: string): string {
  // User explicitly chose a model - respect it
  if (userModel && userModel !== "auto") {
    return userModel;
  }

  const score = scoreComplexity(message);
  return score >= COMPLEXITY_THRESHOLD ? COMPLEX_MODEL : SIMPLE_MODEL;
}

const BASE_SYSTEM_PROMPT = `You are a slide design assistant. You output HTML that will be rendered inside a 16:9 slide container.

When the user describes what they want, output ONLY the HTML content for the slide. No explanation, no markdown code fences, just raw HTML.

The slide container has position: relative, so use position: absolute on elements with percentage-based top/left/right/bottom for positioning.

## Guidelines

Security:
- Do NOT output <script> tags
- Do NOT use inline event handlers (onClick, onLoad, etc.)
- Do NOT use javascript: URLs

Positioning:
- Use position: absolute on all elements
- Use percentages for top/left/right/bottom (e.g., top: 10%, left: 5%)
- Do NOT use translate() to center elements; set explicit top/left and width/height instead
- Only use transform for rotation (rotate(...deg)) if needed

Sizing:
- Prefer percentages for width/height to match the slide container
- Use px for font-size
- Common font sizes: 14, 16, 18, 24, 32, 48, 64, 80px

Shapes:
- Use div elements with background-color
- Circles: border-radius: 50%
- Include width and height

Arrows and Connectors:
- Use SVG for arrows: <svg style="position: absolute; ..."> with <line> or <path>
- Arrow example: <svg style="position: absolute; top: 45%; left: 30%; width: 10%; height: 10%;"><line x1="0" y1="50%" x2="100%" y2="50%" stroke="#333" stroke-width="2" marker-end="url(#arrow)"/><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#333"/></marker></defs></svg>
- Position arrows to visually connect elements (arrow left = box1 right edge, arrow right = box2 left edge)

Diagrams and Flowcharts:
- For horizontal flows: distribute boxes evenly (e.g., 10%, 40%, 70% left positions)
- Place arrows between boxes, not at fixed intervals
- Arrows should be placed at the midpoint of its origin and destination edge unless specified
- Keep elements compact - avoid spreading across the entire slide
- Typical box width: 15-20%, arrow width: 5-8%

Text:
- Use div elements
- font-weight: 400 (normal), 600 (semibold), 700 (bold)

Colors:
- Use hex values: #ffffff, #1a1a2e
- For transparency: rgba(0, 0, 0, 0.5)

## Example: Title slide

<div style="position: absolute; top: 40%; left: 20%; width: 60%; height: 20%; font-size: 64px; font-weight: 700; color: #1a1a2e;">
  Hello World
</div>
<div style="position: absolute; top: 5%; right: 5%; width: 80px; height: 80px; border-radius: 50%; background-color: #e94560;">
</div>

## Example: Three connected boxes (flowchart)

<div style="position: absolute; top: 35%; left: 10%; width: 18%; height: 30%; background: #4A90D9; border-radius: 8px;"></div>
<svg style="position: absolute; top: 47%; left: 28%; width: 8%; height: 6%;"><line x1="0" y1="50%" x2="90%" y2="50%" stroke="#333" stroke-width="2" marker-end="url(#a1)"/><defs><marker id="a1" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#333"/></marker></defs></svg>
<div style="position: absolute; top: 35%; left: 36%; width: 18%; height: 30%; background: #5CB85C; border-radius: 8px;"></div>
<svg style="position: absolute; top: 47%; left: 54%; width: 8%; height: 6%;"><line x1="0" y1="50%" x2="90%" y2="50%" stroke="#333" stroke-width="2" marker-end="url(#a2)"/><defs><marker id="a2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#333"/></marker></defs></svg>
<div style="position: absolute; top: 35%; left: 62%; width: 18%; height: 30%; background: #D9534F; border-radius: 8px;"></div>

## Important

- Output the COMPLETE slide HTML each time (all elements, not just changes)
- When user says "make it bigger" or "change the color", output the full updated HTML
- Maintain all existing elements unless told to remove them
- No markdown, no code fences, no explanations - just HTML

## Asking for Clarification

If you need more information before generating the slide, wrap your question in a <clarify> tag:

<clarify>What color scheme would you prefer - light or dark?</clarify>

Use this when:
- The request is ambiguous (e.g., "make a slide" with no details)
- You need specific information (colors, layout preference, content)
- Multiple interpretations are possible

When using <clarify>, output ONLY the clarify tag - no HTML, no other text.

## Structured Diagrams

For flowcharts, process diagrams, grids, or hierarchies, use the structured diagram format instead of raw HTML. This ensures perfect positioning.

<diagram>
{
  "layout": { "type": "flowchart", "direction": "horizontal" },
  "nodes": [
    { "id": "a", "label": "Start", "style": { "fill": "#4A90D9" } },
    { "id": "b", "label": "Process", "style": { "fill": "#5CB85C" } },
    { "id": "c", "label": "End", "style": { "fill": "#D9534F" } }
  ],
  "connectors": [
    { "from": "a", "to": "b" },
    { "from": "b", "to": "c" }
  ]
}
</diagram>

Layout types:
- flowchart: Linear flow with direction "horizontal" or "vertical"
- grid: Matrix arrangement with { "type": "grid", "columns": 3 }
- hierarchy: Tree structure with direction "top-down" or "left-right"

Node styles:
- shape: "rect", "roundRect", "ellipse", "diamond"
- fill: hex color like "#4A90D9"
- stroke: border color
- textColor: text color (default white)

Connector styles:
- stroke: line color
- arrowHead: "arrow" or "none"
- dashed: true for dashed lines
- label: short text to place on the connector

Use <diagram> when:
- User asks for a flowchart, process diagram, or workflow
- Multiple boxes or shapes need to be connected with arrows
- Elements should be evenly distributed or aligned
- Creating org charts, decision trees, or step-by-step processes

Continue using raw HTML for:
- Simple title slides with just text
- Text-only content
- Freeform layouts where specific positioning is requested
- Single elements or decorative shapes

When using <diagram>, output ONLY the diagram tag with valid JSON - no HTML, no other text.`;

function buildSystemPrompt(_currentHtml: string): string {
  return BASE_SYSTEM_PROMPT;
}

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
    system: buildSystemPrompt(currentHtml),
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
  const openAiMessages = [
    { role: "system" as const, content: buildSystemPrompt(currentHtml) },
    ...withStateContext(messages, currentHtml).map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];
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
      systemInstruction: buildSystemPrompt(currentHtml),
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

async function* streamAnthropic(
  model: string,
  messages: Message[],
  currentHtml: string
): AsyncGenerator<string> {
  const claudeMessages = withStateContext(messages, currentHtml);
  const stream = getAnthropicClient().messages.stream({
    model,
    max_tokens: MAX_GENERATION_TOKENS,
    system: buildSystemPrompt(currentHtml),
    messages: claudeMessages,
  });

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}

async function* streamOpenAI(
  model: string,
  messages: Message[],
  currentHtml: string
): AsyncGenerator<string> {
  const openAiMessages = [
    { role: "system" as const, content: buildSystemPrompt(currentHtml) },
    ...withStateContext(messages, currentHtml).map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];
  const stream = await getOpenAIClient().chat.completions.create({
    model,
    max_completion_tokens: MAX_GENERATION_TOKENS,
    messages: openAiMessages,
    stream: true,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      yield content;
    }
  }
}

async function* streamGoogle(
  model: string,
  messages: Message[],
  currentHtml: string
): AsyncGenerator<string> {
  const contextMessages = withStateContext(messages, currentHtml);
  const contents = contextMessages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const response = await getGoogleClient().models.generateContentStream({
    model,
    contents,
    config: {
      systemInstruction: buildSystemPrompt(currentHtml),
      maxOutputTokens: MAX_GENERATION_TOKENS,
    },
  });

  for await (const chunk of response) {
    const text = chunk.text;
    if (text) {
      yield text;
    }
  }
}

export async function* generateSlideStream(
  messages: Message[],
  currentHtml: string,
  model = DEFAULT_MODEL
): AsyncGenerator<string> {
  const provider = inferProvider(model);
  if (provider === "anthropic") {
    yield* streamAnthropic(model, messages, currentHtml);
  } else if (provider === "google") {
    yield* streamGoogle(model, messages, currentHtml);
  } else {
    yield* streamOpenAI(model, messages, currentHtml);
  }
}

export function getDefaultModel() {
  return DEFAULT_MODEL;
}

/**
 * Parsed output from the model.
 */
export type ParsedModelOutput =
  | { type: "diagram"; intent: DiagramIntent }
  | { type: "html"; html: string }
  | { type: "clarify"; question: string };

/**
 * Parse model output to detect diagram, clarify, or raw HTML content.
 */
export function parseModelOutput(raw: string): ParsedModelOutput {
  const trimmed = raw.trim();

  // Check for clarify tag first
  const clarifyMatch = trimmed.match(/<clarify>([\s\S]*?)<\/clarify>/);
  if (clarifyMatch) {
    return { type: "clarify", question: clarifyMatch[1].trim() };
  }

  // Check for diagram tag
  const diagramMatch = trimmed.match(/<diagram>([\s\S]*?)<\/diagram>/);
  if (diagramMatch) {
    try {
      const intent = JSON.parse(diagramMatch[1]) as DiagramIntent;
      return { type: "diagram", intent };
    } catch (e) {
      try {
        const cleaned = stripCodeFences(diagramMatch[1]);
        const intent = JSON.parse(cleaned) as DiagramIntent;
        return { type: "diagram", intent };
      } catch (innerError) {
        // Invalid JSON, fall back to HTML
        console.warn("Failed to parse diagram JSON:", innerError);
      }
    }
  }

  // Default to raw HTML
  return { type: "html", html: raw };
}

function stripCodeFences(value: string): string {
  const trimmed = value.trim();
  const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

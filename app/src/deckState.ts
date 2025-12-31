import type { DeckState, Message, Slide } from "./types";
import { sanitizeHtml } from "./sanitize";

function isValidMessage(value: unknown): value is Message {
  if (!value || typeof value !== "object") return false;
  const message = value as Message;
  return (message.role === "user" || message.role === "assistant") && typeof message.content === "string";
}

function normalizeMessages(input: unknown): Message[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isValidMessage);
}

function normalizeSlides(input: unknown): Slide[] {
  if (!Array.isArray(input)) return [];

  const slides: Slide[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const slide = item as Slide;
    if (typeof slide.id !== "string" || typeof slide.html !== "string") continue;
    slides.push({
      ...slide,
      html: sanitizeHtml(slide.html),
    });
  }
  return slides;
}

export function normalizeDeckState(input: unknown): DeckState | null {
  if (!input || typeof input !== "object") return null;
  const candidate = input as DeckState;

  const slides = normalizeSlides(candidate.slides);
  if (slides.length === 0) return null;

  const messages = normalizeMessages(candidate.messages);
  const model = typeof candidate.model === "string" ? candidate.model : "";
  const index = Number.isInteger(candidate.currentSlideIndex)
    ? candidate.currentSlideIndex
    : 0;
  const clampedIndex = Math.min(Math.max(0, index), slides.length - 1);

  return {
    slides,
    currentSlideIndex: clampedIndex,
    messages,
    model,
  };
}

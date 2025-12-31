import type { Message, Slide } from "./types";
import { sanitizeHtml } from "./sanitize";

const STORAGE_KEY = "slideai:deck:v1";

export interface PersistedState {
  slides: Slide[];
  currentSlideIndex: number;
  messages: Message[];
  model: string;
}

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

export function loadPersistedState(): PersistedState | null {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PersistedState;
    const slides = normalizeSlides(parsed?.slides);
    if (slides.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const messages = normalizeMessages(parsed?.messages);
    const model = typeof parsed?.model === "string" ? parsed.model : "";
    const index = Number.isInteger(parsed?.currentSlideIndex)
      ? parsed.currentSlideIndex
      : 0;
    const clampedIndex = Math.min(Math.max(0, index), slides.length - 1);

    return {
      slides,
      currentSlideIndex: clampedIndex,
      messages,
      model,
    };
  } catch (error) {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function savePersistedState(state: PersistedState): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    // Ignore storage failures (quota, private mode, etc.)
  }
}

export function clearPersistedState(): void {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

import type { Slide } from "./types";

function cloneDeep<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function cloneSlideWithNewId(slide: Slide, id: string): Slide {
  const cloned = cloneDeep(slide);
  return { ...cloned, id };
}

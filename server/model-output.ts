import { parseModelOutput, type ParsedModelOutput } from "./llm";
import { layoutDiagram } from "./layout";

export interface ResolvedModelOutput {
  type: ParsedModelOutput["type"];
  html: string;
}

export function resolveModelOutput(raw: string): ResolvedModelOutput {
  const parsed = parseModelOutput(raw);

  if (parsed.type === "diagram") {
    const { html } = layoutDiagram(parsed.intent);
    return { type: "diagram", html };
  }

  return {
    type: parsed.type,
    html: raw,
  };
}

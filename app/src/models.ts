export type Provider = "anthropic" | "openai" | "google" | "auto";

export interface ModelOption {
  value: string;
  label: string;
  provider: Provider;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    value: "auto",
    label: "Auto (smart routing)",
    provider: "auto",
  },
  {
    value: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
  },
  {
    value: "gpt-4.1-mini",
    label: "GPT-4.1 Mini",
    provider: "openai",
  },
  {
    value: "models/gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    provider: "google",
  },
];

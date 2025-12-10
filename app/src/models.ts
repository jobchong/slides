export type Provider = "anthropic" | "openai";

export interface ModelOption {
  value: string;
  label: string;
  provider: Provider;
}

export const MODEL_OPTIONS: ModelOption[] = [
  {
    value: "claude-sonnet-4-20250514",
    label: "Claude Sonnet 4",
    provider: "anthropic",
  },
  {
    value: "claude-sonnet-4-5-20250929",
    label: "Claude Sonnet 4.5",
    provider: "anthropic",
  },
  {
    value: "gpt-5.1-chat-latest",
    label: "GPT-5.1",
    provider: "openai",
  },
  {
    value: "gpt-5.1-mini",
    label: "GPT-5.1 Mini",
    provider: "openai",
  },
];

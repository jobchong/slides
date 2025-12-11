export interface Message {
  role: "user" | "assistant";
  content: string;
}

export interface Slide {
  id: string;
  html: string;
}

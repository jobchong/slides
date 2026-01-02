import { useState, useCallback } from "react";
import type { Message, Slide } from "../types";
import { callModelStream } from "../api";
import { sanitizeHtml } from "../sanitize";

export interface UseChatGenerationOptions {
  slides: Slide[];
  currentSlideIndex: number;
  messages: Message[];
  model: string;
  setSlides: React.Dispatch<React.SetStateAction<Slide[]>>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

export interface UseChatGenerationResult {
  isLoading: boolean;
  error: string | null;
  clearError: () => void;
  handleSend: (userMessage: string) => Promise<void>;
  handleVoiceMessage: (
    transcription: string,
    html: string,
    clarification: string | null
  ) => void;
}

export function useChatGeneration({
  slides,
  currentSlideIndex,
  messages,
  model,
  setSlides,
  setMessages,
}: UseChatGenerationOptions): UseChatGenerationResult {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateCurrentSlideHtml = useCallback(
    (html: string) => {
      setSlides((prev) =>
        prev.map((slide, i) =>
          i === currentSlideIndex ? { ...slide, html: sanitizeHtml(html) } : slide
        )
      );
    },
    [currentSlideIndex, setSlides]
  );

  const commitCurrentSlideHtml = useCallback(
    (html: string) => {
      setSlides((prev) =>
        prev.map((slide, i) => {
          if (i !== currentSlideIndex) return slide;
          return { ...slide, html: sanitizeHtml(html), source: undefined };
        })
      );
    },
    [currentSlideIndex, setSlides]
  );

  const handleSend = useCallback(
    async (userMessage: string) => {
      const currentSlide = slides[currentSlideIndex];
      const newMessages: Message[] = [
        ...messages,
        { role: "user", content: userMessage },
      ];
      setMessages(newMessages);
      setIsLoading(true);
      setError(null);

      try {
        const result = await callModelStream(
          newMessages,
          currentSlide.html,
          model,
          (partialHtml) => updateCurrentSlideHtml(partialHtml)
        );

        commitCurrentSlideHtml(result.html);

        if (result.clarification) {
          setMessages([
            ...newMessages,
            { role: "assistant", content: result.clarification },
          ]);
        } else {
          setMessages([...newMessages, { role: "assistant", content: "Done." }]);
        }
      } catch (err) {
        console.error("Error calling model:", err);
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    },
    [
      slides,
      currentSlideIndex,
      messages,
      model,
      setMessages,
      updateCurrentSlideHtml,
      commitCurrentSlideHtml,
    ]
  );

  const handleVoiceMessage = useCallback(
    (transcription: string, html: string, clarification: string | null) => {
      if (clarification) {
        setMessages([
          ...messages,
          { role: "user", content: transcription },
          { role: "assistant", content: clarification },
        ]);
      } else {
        setMessages([
          ...messages,
          { role: "user", content: transcription },
          { role: "assistant", content: "Done." },
        ]);
      }
      commitCurrentSlideHtml(html);
    },
    [messages, setMessages, commitCurrentSlideHtml]
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return {
    isLoading,
    error,
    clearError,
    handleSend,
    handleVoiceMessage,
  };
}

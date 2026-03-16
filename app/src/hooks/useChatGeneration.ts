import { useState, useCallback, useRef } from "react";
import type { Message, Slide } from "../types";
import { callModelStream } from "../api";
import { sanitizeHtml } from "../sanitize";
import { classifyGenerationError, formatError } from "../errors";

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
  errorRetryable: boolean;
  clearError: () => void;
  retryLastMessage: () => void;
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
  const [errorRetryable, setErrorRetryable] = useState(false);
  const lastMessageRef = useRef<string | null>(null);

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
      lastMessageRef.current = userMessage;
      const currentSlide = slides[currentSlideIndex];
      const originalHtml = currentSlide.html;
      const newMessages: Message[] = [
        ...messages,
        { role: "user", content: userMessage },
      ];
      setMessages(newMessages);
      setIsLoading(true);
      setError(null);
      setErrorRetryable(false);

      try {
        let hasStreamedHtml = false;
        const result = await callModelStream(
          newMessages,
          currentSlide.html,
          model,
          (partialHtml) => {
            if (partialHtml.length === 0 && !hasStreamedHtml) {
              return;
            }
            hasStreamedHtml = true;
            updateCurrentSlideHtml(partialHtml);
          }
        );

        if (result.clarification) {
          updateCurrentSlideHtml(originalHtml);
          setMessages([
            ...newMessages,
            { role: "assistant", content: result.clarification },
          ]);
        } else {
          commitCurrentSlideHtml(result.html);
          setMessages([...newMessages, { role: "assistant", content: "Done." }]);
        }
        lastMessageRef.current = null;
      } catch (err) {
        const appError = classifyGenerationError(err);
        setError(formatError(appError));
        setErrorRetryable(appError.retryable);
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
        commitCurrentSlideHtml(html);
      }
    },
    [messages, setMessages, commitCurrentSlideHtml]
  );

  const clearError = useCallback(() => {
    setError(null);
    setErrorRetryable(false);
  }, []);

  const retryLastMessage = useCallback(() => {
    if (lastMessageRef.current) {
      // Remove the failed user message before retrying
      setMessages((prev) => prev.slice(0, -1));
      handleSend(lastMessageRef.current);
    }
  }, [handleSend, setMessages]);

  return {
    isLoading,
    error,
    errorRetryable,
    clearError,
    retryLastMessage,
    handleSend,
    handleVoiceMessage,
  };
}

import { useState, useEffect, useCallback } from "react";
import type { Message, Slide, SlideSource } from "../types";
import { normalizeDeckState } from "../deckState";
import {
  clearStoredDeckId,
  createDeck,
  getStoredDeckId,
  isServerDeckStorageEnabled,
  loadDeck,
  saveDeck,
  setStoredDeckId,
} from "../deckApi";
import { clearPersistedState } from "../storage";

function createEmptySource(): SlideSource {
  return { background: { type: "none" }, elements: [] };
}

function createSlide(): Slide {
  return { id: crypto.randomUUID(), html: "", source: createEmptySource() };
}

export interface UseDeckSyncOptions {
  slides: Slide[];
  currentSlideIndex: number;
  messages: Message[];
  model: string;
  setSlides: (slides: Slide[]) => void;
  setCurrentSlideIndex: (index: number) => void;
  setMessages: (messages: Message[]) => void;
  setModel: (model: string) => void;
  setError: (error: string | null) => void;
}

export interface UseDeckSyncResult {
  deckId: string | null;
  isHydrated: boolean;
  isServerStorageEnabled: boolean;
  handleNewDeck: () => void;
}

export function useDeckSync({
  slides,
  currentSlideIndex,
  messages,
  model,
  setSlides,
  setCurrentSlideIndex,
  setMessages,
  setModel,
  setError,
}: UseDeckSyncOptions): UseDeckSyncResult {
  const [deckId, setDeckId] = useState<string | null>(() => getStoredDeckId());
  const [isHydrated, setIsHydrated] = useState(false);
  const isServerStorageEnabled = isServerDeckStorageEnabled();

  // Hydration effect
  useEffect(() => {
    let isActive = true;

    const hydrateDeck = async () => {
      if (!isServerStorageEnabled) {
        setIsHydrated(true);
        return;
      }
      if (isHydrated && !deckId) {
        return;
      }

      try {
        if (deckId) {
          const remote = await loadDeck(deckId);
          const normalized = normalizeDeckState(remote.state);
          if (normalized && isActive) {
            setSlides(normalized.slides);
            setCurrentSlideIndex(normalized.currentSlideIndex);
            setMessages(normalized.messages);
            setModel(normalized.model || model);
            setIsHydrated(true);
            return;
          }
        }
      } catch (err) {
        console.error("Failed to hydrate deck:", err);
      } finally {
        if (!isActive) return;
      }

      try {
        const fallbackState = {
          slides,
          currentSlideIndex,
          messages,
          model,
        };
        const created = await createDeck(fallbackState);
        if (!isActive) return;
        setDeckId(created.id);
        setStoredDeckId(created.id);
      } catch (err) {
        console.error("Failed to create fallback deck:", err);
      } finally {
        if (isActive) setIsHydrated(true);
      }
    };

    void hydrateDeck();
    return () => {
      isActive = false;
    };
  }, [deckId, isServerStorageEnabled, isHydrated]);

  // Auto-save effect with debounce
  useEffect(() => {
    if (!isServerStorageEnabled || !isHydrated || !deckId) return;

    const payload = {
      slides,
      currentSlideIndex,
      messages,
      model,
    };

    const timeout = window.setTimeout(() => {
      saveDeck(deckId, payload).catch((err) => {
        console.error("Failed to save deck:", err);
      });
    }, 800);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [slides, currentSlideIndex, messages, model, deckId, isHydrated, isServerStorageEnabled]);

  const handleNewDeck = useCallback(() => {
    if (!window.confirm("Start a new deck? This clears the current slides and chat history.")) {
      return;
    }
    clearPersistedState();
    clearStoredDeckId();
    const freshSlide = createSlide();
    setDeckId(null);
    setSlides([freshSlide]);
    setCurrentSlideIndex(0);
    setMessages([]);
    setError(null);
    if (isServerStorageEnabled) {
      void createDeck({
        slides: [freshSlide],
        currentSlideIndex: 0,
        messages: [],
        model,
      })
        .then((created) => {
          setDeckId(created.id);
          setStoredDeckId(created.id);
        })
        .catch((err) => {
          console.error("Failed to create new deck:", err);
        });
    }
  }, [isServerStorageEnabled, model, setSlides, setCurrentSlideIndex, setMessages, setError]);

  return {
    deckId,
    isHydrated,
    isServerStorageEnabled,
    handleNewDeck,
  };
}

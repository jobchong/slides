import { useState, useRef, useMemo, useEffect } from "react";
import type { Message, Slide, SlideSource } from "./types";
import { SlideView } from "./components/SlideView";
import { ChatInput } from "./components/ChatInput";
import { ThumbnailPanel } from "./components/ThumbnailPanel";
import { SlideNavigation } from "./components/SlideNavigation";
import { ImportProgress } from "./components/ImportProgress";
import { useSlideNavigation } from "./hooks/useSlideNavigation";
import { callModelStream, exportDeck, importPptx, type ImportProgress as ImportProgressType } from "./api";
import { MODEL_OPTIONS } from "./models";
import { sanitizeHtml } from "./sanitize";
import { normalizeDeckState } from "./deckState";
import {
  clearStoredDeckId,
  createDeck,
  getStoredDeckId,
  isServerDeckStorageEnabled,
  loadDeck,
  saveDeck,
  setStoredDeckId,
} from "./deckApi";
import { clearPersistedState, loadPersistedState, savePersistedState } from "./storage";
import { cloneSlideWithNewId } from "./slideUtils";
import "./App.css";

function createEmptySource(): SlideSource {
  return { background: { type: "none" }, elements: [] };
}

function createSlide(): Slide {
  return { id: crypto.randomUUID(), html: "", source: createEmptySource() };
}

export default function App() {
  const initialPersistedState = useMemo(() => loadPersistedState(), []);
  const [slides, setSlides] = useState<Slide[]>(
    () => initialPersistedState?.slides ?? [createSlide()]
  );
  const [currentSlideIndex, setCurrentSlideIndex] = useState(
    () => initialPersistedState?.currentSlideIndex ?? 0
  );
  const [messages, setMessages] = useState<Message[]>(
    () => initialPersistedState?.messages ?? []
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressType | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importAbortRef = useRef(false);
  const importControllerRef = useRef<AbortController | null>(null);
  const initialModel =
    import.meta.env.VITE_DEFAULT_MODEL || MODEL_OPTIONS[0].value;
  const [model, setModel] = useState(() => {
    if (
      initialPersistedState?.model &&
      MODEL_OPTIONS.some((option) => option.value === initialPersistedState.model)
    ) {
      return initialPersistedState.model;
    }
    return initialModel;
  });
  const [deckId, setDeckId] = useState<string | null>(() => getStoredDeckId());
  const [isHydrated, setIsHydrated] = useState(false);
  const isServerStorageEnabled = isServerDeckStorageEnabled();

  const currentSlide = slides[currentSlideIndex];

  const updateCurrentSlideHtml = (html: string) => {
    setSlides((prev) =>
      prev.map((slide, i) =>
        i === currentSlideIndex ? { ...slide, html: sanitizeHtml(html) } : slide
      )
    );
  };

  const commitCurrentSlideHtml = (html: string) => {
    setSlides((prev) =>
      prev.map((slide, i) => {
        if (i !== currentSlideIndex) return slide;
        return { ...slide, html: sanitizeHtml(html), source: undefined };
      })
    );
  };

  const handleSend = async (userMessage: string) => {
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
        // LLM is asking for clarification - show as assistant message
        setMessages([
          ...newMessages,
          { role: "assistant", content: result.clarification },
        ]);
      } else {
        // Normal slide generation
        setMessages([...newMessages, { role: "assistant", content: "Done." }]);
      }
    } catch (err) {
      console.error("Error calling model:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceMessage = (transcription: string, html: string, clarification: string | null) => {
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
  };

  const handleAddSlide = () => {
    const newSlide = createSlide();
    setSlides((prev) => [
      ...prev.slice(0, currentSlideIndex + 1),
      newSlide,
      ...prev.slice(currentSlideIndex + 1),
    ]);
    setCurrentSlideIndex(currentSlideIndex + 1);
  };

  const handleDeleteSlide = (index: number) => {
    if (slides.length <= 1) return;
    setSlides((prev) => prev.filter((_, i) => i !== index));
    if (index <= currentSlideIndex && currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1);
    }
  };

  const handlePrevSlide = () => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1);
    }
  };

  const handleNextSlide = () => {
    if (currentSlideIndex < slides.length - 1) {
      setCurrentSlideIndex(currentSlideIndex + 1);
    }
  };

  const handleGoToSlide = (index: number) => {
    if (index >= 0 && index < slides.length) {
      setCurrentSlideIndex(index);
    }
  };

  const handleFirstSlide = () => setCurrentSlideIndex(0);
  const handleLastSlide = () => setCurrentSlideIndex(slides.length - 1);
  const handleDuplicateSlide = () => {
    const slideToDuplicate = slides[currentSlideIndex];
    if (!slideToDuplicate) return;
    const duplicated = cloneSlideWithNewId(slideToDuplicate, crypto.randomUUID());
    setSlides((prev) => {
      const next = [...prev];
      next.splice(currentSlideIndex + 1, 0, duplicated);
      return next;
    });
    setCurrentSlideIndex(currentSlideIndex + 1);
  };
  const handleNewDeck = () => {
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
  };

  useSlideNavigation({
    onPrev: handlePrevSlide,
    onNext: handleNextSlide,
    onFirst: handleFirstSlide,
    onLast: handleLastSlide,
    onAdd: handleAddSlide,
    onDelete: () => handleDeleteSlide(currentSlideIndex),
  });

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleExportClick = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setError(null);
    try {
      const blob = await exportDeck(slides);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "slides.pptx";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export failed:", err);
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImportCancel = () => {
    importAbortRef.current = true;
    importControllerRef.current?.abort();
    importControllerRef.current = null;
    setIsImporting(false);
    setImportProgress(null);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset the input so the same file can be selected again
    e.target.value = "";

    setIsImporting(true);
    setImportProgress({ type: "progress", status: "Starting import..." });
    importAbortRef.current = false;
    importControllerRef.current = new AbortController();

    const initialSlideCount = slides.length;
    const replacingEmptySlide =
      initialSlideCount === 1 && slides[0].html === "";
    const importedSlides: Slide[] = [];

    try {
      await importPptx(
        file,
        (progress) => {
          if (importAbortRef.current) return;
          setImportProgress(progress);
        },
        (slide) => {
          if (importAbortRef.current) return;
          const normalizedSlide = { ...slide, html: sanitizeHtml(slide.html) };
          importedSlides.push(normalizedSlide);
          // Update slides as they come in so user sees progress
          setSlides((prev) => {
            // If first import and only empty slide exists, replace it
            if (prev.length === 1 && prev[0].html === "" && importedSlides.length === 1) {
              return [normalizedSlide];
            }
            return [...prev, normalizedSlide];
          });
        },
        { signal: importControllerRef.current.signal }
      );

      if (!importAbortRef.current && importedSlides.length > 0) {
        // Navigate to first imported slide
        setCurrentSlideIndex(replacingEmptySlide ? 0 : initialSlideCount);
        setMessages([]);
      }
    } catch (err) {
      if (!importAbortRef.current) {
        console.error("Import failed:", err);
        setError(err instanceof Error ? err.message : "Import failed");
      }
    } finally {
      importControllerRef.current = null;
      setIsImporting(false);
      setImportProgress(null);
    }
  };

  useEffect(() => {
    savePersistedState({
      slides,
      currentSlideIndex,
      messages,
      model,
    });
  }, [slides, currentSlideIndex, messages, model]);

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

  return (
    <div className="app">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pptx"
        style={{ display: "none" }}
        onChange={handleFileSelect}
      />
      <ThumbnailPanel
        slides={slides}
        currentIndex={currentSlideIndex}
        onSelect={handleGoToSlide}
        onAdd={handleAddSlide}
        onDelete={handleDeleteSlide}
        onDuplicate={handleDuplicateSlide}
        onNewDeck={handleNewDeck}
        onExport={handleExportClick}
        onImport={handleImportClick}
        isImporting={isImporting}
        isExporting={isExporting}
      />
      <ImportProgress progress={importProgress} onCancel={handleImportCancel} />
      <div className="app-main">
        <div className="app-slide-container">
          <SlideView html={currentSlide.html} isLoading={isLoading} />
        </div>
        <SlideNavigation
          currentIndex={currentSlideIndex}
          total={slides.length}
          onPrev={handlePrevSlide}
          onNext={handleNextSlide}
        />
        <div className="app-chat">
          <ChatInput
            messages={messages}
            slideHtml={currentSlide.html}
            onSend={handleSend}
            onVoiceMessage={handleVoiceMessage}
            isLoading={isLoading}
            model={model}
            onModelChange={setModel}
            error={error}
            onErrorDismiss={() => setError(null)}
          />
        </div>
      </div>
    </div>
  );
}

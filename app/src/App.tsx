import { useState, useMemo, useEffect } from "react";
import type { Message, Slide, SlideSource } from "./types";
import { SlideView } from "./components/SlideView";
import { ChatInput } from "./components/ChatInput";
import { ThumbnailPanel } from "./components/ThumbnailPanel";
import { SlideNavigation } from "./components/SlideNavigation";
import { ImportProgress } from "./components/ImportProgress";
import { useSlideNavigation } from "./hooks/useSlideNavigation";
import { useSlideOperations } from "./hooks/useSlideOperations";
import { useChatGeneration } from "./hooks/useChatGeneration";
import { useImportExport } from "./hooks/useImportExport";
import { useDeckSync } from "./hooks/useDeckSync";
import { MODEL_OPTIONS } from "./models";
import { loadPersistedState, savePersistedState } from "./storage";
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

  // Slide operations hook
  const {
    currentSlide,
    handleAddSlide,
    handleDeleteSlide,
    handleDuplicateSlide,
    handleGoToSlide,
    handlePrevSlide,
    handleNextSlide,
    handleFirstSlide,
    handleLastSlide,
  } = useSlideOperations({
    slides,
    currentSlideIndex,
    setSlides,
    setCurrentSlideIndex,
  });

  // Chat generation hook
  const {
    isLoading,
    error,
    clearError,
    handleSend,
    handleVoiceMessage,
  } = useChatGeneration({
    slides,
    currentSlideIndex,
    messages,
    model,
    setSlides,
    setMessages,
  });

  // Import/export hook
  const {
    isImporting,
    isExporting,
    importProgress,
    importExportError,
    fileInputRef,
    handleImportClick,
    handleExportClick,
    handleFileSelect,
    handleImportCancel,
    clearImportExportError,
  } = useImportExport({
    slides,
    setSlides,
    setCurrentSlideIndex,
    setMessages: () => setMessages([]),
  });

  // Deck sync hook
  const { handleNewDeck } = useDeckSync({
    slides,
    currentSlideIndex,
    messages,
    model,
    setSlides,
    setCurrentSlideIndex,
    setMessages,
    setModel,
    setError: clearError,
  });

  // Keyboard navigation
  useSlideNavigation({
    onPrev: handlePrevSlide,
    onNext: handleNextSlide,
    onFirst: handleFirstSlide,
    onLast: handleLastSlide,
    onAdd: handleAddSlide,
    onDelete: () => handleDeleteSlide(currentSlideIndex),
  });

  // Local persistence effect
  useEffect(() => {
    savePersistedState({
      slides,
      currentSlideIndex,
      messages,
      model,
    });
  }, [slides, currentSlideIndex, messages, model]);

  // Combined error from chat or import/export
  const displayError = error || importExportError;
  const handleErrorDismiss = () => {
    clearError();
    clearImportExportError();
  };

  return (
    <div className="app">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pptx"
        style={{ display: "none" }}
        onChange={handleFileSelect}
        aria-hidden="true"
      />
      <nav aria-label="Slide thumbnails">
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
      </nav>
      <ImportProgress progress={importProgress} onCancel={handleImportCancel} />
      <main className="app-main">
        <div className="app-slide-container" role="region" aria-label="Current slide">
          <SlideView html={currentSlide.html} isLoading={isLoading} />
        </div>
        {slides.length > 1 && (
          <SlideNavigation
            currentIndex={currentSlideIndex}
            total={slides.length}
            onPrev={handlePrevSlide}
            onNext={handleNextSlide}
          />
        )}
        <div className="app-chat" role="region" aria-label="Chat interface">
          <ChatInput
            messages={messages}
            slideHtml={currentSlide.html}
            onSend={handleSend}
            onVoiceMessage={handleVoiceMessage}
            isLoading={isLoading}
            model={model}
            onModelChange={setModel}
            error={displayError}
            onErrorDismiss={handleErrorDismiss}
          />
        </div>
      </main>
    </div>
  );
}

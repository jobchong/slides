import { useState, useMemo, useEffect } from "react";
import type { Message, Slide, SlideSource } from "./types";
import { SlideView } from "./components/SlideView";
import { ChatInput } from "./components/ChatInput";
import { ThumbnailPanel } from "./components/ThumbnailPanel";
import { MobileDrawer } from "./components/MobileDrawer";
import { SlideNavigation } from "./components/SlideNavigation";
import { ImportProgress } from "./components/ImportProgress";
import { SkipLink } from "./components/SkipLink";
import { Announcer } from "./components/Announcer";
import { useSlideNavigation } from "./hooks/useSlideNavigation";
import { useSlideOperations } from "./hooks/useSlideOperations";
import { useChatGeneration } from "./hooks/useChatGeneration";
import { useImportExport } from "./hooks/useImportExport";
import { useDeckSync } from "./hooks/useDeckSync";
import { useFocusReturn } from "./hooks/useFocusReturn";
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
    errorRetryable,
    clearError,
    retryLastMessage,
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

  // Mobile drawer state
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false);
  const { saveFocus, restoreFocus } = useFocusReturn();

  // Screen reader announcements
  const [announcement, setAnnouncement] = useState("");

  const handleOpenDrawer = () => {
    saveFocus();
    setIsMobileDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setIsMobileDrawerOpen(false);
    restoreFocus();
  };

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
  const displayErrorRetryable = error ? errorRetryable : false;
  const handleErrorDismiss = () => {
    clearError();
    clearImportExportError();
  };
  const handleErrorRetry = error ? retryLastMessage : undefined;

  // Announce loading state changes
  useEffect(() => {
    if (isLoading) {
      setAnnouncement("Generating slide content...");
    }
  }, [isLoading]);

  // Announce when generation completes
  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage?.role === "assistant" && lastMessage.content === "Done.") {
      setAnnouncement("Slide updated successfully.");
    }
  }, [messages]);

  // Announce errors
  useEffect(() => {
    if (displayError) {
      setAnnouncement(`Error: ${displayError}`);
    }
  }, [displayError]);

  // Announce slide changes
  useEffect(() => {
    if (slides.length > 1) {
      setAnnouncement(`Slide ${currentSlideIndex + 1} of ${slides.length}`);
    }
  }, [currentSlideIndex, slides.length]);

  return (
    <div className="app">
      <SkipLink targetId="main-content">Skip to slide</SkipLink>
      <SkipLink targetId="chat-input">Skip to chat</SkipLink>
      <Announcer message={announcement} />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pptx"
        style={{ display: "none" }}
        onChange={handleFileSelect}
        aria-hidden="true"
      />
      <button
        className="mobile-menu-toggle"
        onClick={handleOpenDrawer}
        aria-label="Open slide navigation"
      >
        <span className="mobile-menu-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
      <MobileDrawer
        isOpen={isMobileDrawerOpen}
        onClose={handleCloseDrawer}
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
        <div
          id="main-content"
          className="app-slide-container"
          role="region"
          aria-label="Current slide"
          tabIndex={-1}
        >
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
        <div id="chat-input" className="app-chat" role="region" aria-label="Chat interface" tabIndex={-1}>
          <ChatInput
            messages={messages}
            slideHtml={currentSlide.html}
            onSend={handleSend}
            onVoiceMessage={handleVoiceMessage}
            isLoading={isLoading}
            model={model}
            onModelChange={setModel}
            error={displayError}
            errorRetryable={displayErrorRetryable}
            onErrorDismiss={handleErrorDismiss}
            onErrorRetry={handleErrorRetry}
          />
        </div>
      </main>
    </div>
  );
}

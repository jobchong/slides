import { useState, useRef } from "react";
import type { Message, Slide, SlideSource } from "./types";
import { SlideView } from "./components/SlideView";
import { ChatInput } from "./components/ChatInput";
import { ThumbnailPanel } from "./components/ThumbnailPanel";
import { SlideNavigation } from "./components/SlideNavigation";
import { ImportProgress } from "./components/ImportProgress";
import { useSlideNavigation } from "./hooks/useSlideNavigation";
import { callModelStream, importPptx, type ImportProgress as ImportProgressType } from "./api";
import { MODEL_OPTIONS } from "./models";
import { htmlToScene, sceneToHtml } from "./render/scene";
import "./App.css";

function createEmptySource(): SlideSource {
  return { background: { type: "none" }, elements: [] };
}

function buildSlideFromSource(source: SlideSource): Slide {
  return { id: crypto.randomUUID(), html: sceneToHtml(source), source };
}

function createSlide(): Slide {
  return buildSlideFromSource(createEmptySource());
}

export default function App() {
  const [slides, setSlides] = useState<Slide[]>([createSlide()]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressType | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importAbortRef = useRef(false);
  const initialModel =
    import.meta.env.VITE_DEFAULT_MODEL || MODEL_OPTIONS[0].value;
  const [model, setModel] = useState(initialModel);

  const currentSlide = slides[currentSlideIndex];

  const updateCurrentSlideHtml = (html: string) => {
    setSlides((prev) =>
      prev.map((slide, i) =>
        i === currentSlideIndex ? { ...slide, html } : slide
      )
    );
  };

  const commitCurrentSlideHtml = (html: string) => {
    setSlides((prev) =>
      prev.map((slide, i) => {
        if (i !== currentSlideIndex) return slide;
        try {
          const source = htmlToScene(html);
          return { ...slide, source, html: sceneToHtml(source) };
        } catch (err) {
          console.warn("Failed to parse slide HTML into scene graph:", err);
          return { ...slide, html };
        }
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

  const handleVoiceMessage = (transcription: string, html: string) => {
    setMessages([
      ...messages,
      { role: "user", content: transcription },
      { role: "assistant", content: "Done." },
    ]);
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

  const handleImportCancel = () => {
    importAbortRef.current = true;
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
          const hasRenderableSource =
            !!slide.source &&
            (slide.source.elements.length > 0 || slide.source.background.type !== "none");
          const normalizedSlide = hasRenderableSource
            ? { ...slide, html: sceneToHtml(slide.source!) }
            : slide;
          importedSlides.push(normalizedSlide);
          // Update slides as they come in so user sees progress
          setSlides((prev) => {
            // If first import and only empty slide exists, replace it
            if (prev.length === 1 && prev[0].html === "" && importedSlides.length === 1) {
              return [normalizedSlide];
            }
            return [...prev, normalizedSlide];
          });
        }
      );

      if (!importAbortRef.current && importedSlides.length > 0) {
        // Navigate to first imported slide
        setCurrentSlideIndex(replacingEmptySlide ? 0 : initialSlideCount);
        setMessages([]);
      }
    } catch (err) {
      console.error("Import failed:", err);
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setIsImporting(false);
      setImportProgress(null);
    }
  };

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
        onImport={handleImportClick}
        isImporting={isImporting}
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

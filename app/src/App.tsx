import { useState } from "react";
import type { Message, Slide } from "./types";
import { SlideView } from "./components/SlideView";
import { ChatInput } from "./components/ChatInput";
import { ThumbnailPanel } from "./components/ThumbnailPanel";
import { SlideNavigation } from "./components/SlideNavigation";
import { useSlideNavigation } from "./hooks/useSlideNavigation";
import { callModel } from "./api";
import { MODEL_OPTIONS } from "./models";
import "./App.css";

function createSlide(): Slide {
  return { id: crypto.randomUUID(), html: "" };
}

export default function App() {
  const [slides, setSlides] = useState<Slide[]>([createSlide()]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialModel =
    import.meta.env.VITE_DEFAULT_MODEL || MODEL_OPTIONS[0].value;
  const [model, setModel] = useState(initialModel);

  const currentSlide = slides[currentSlideIndex];

  const updateCurrentSlide = (html: string) => {
    setSlides((prev) =>
      prev.map((slide, i) =>
        i === currentSlideIndex ? { ...slide, html } : slide
      )
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
      const html = await callModel(newMessages, currentSlide.html, model);
      updateCurrentSlide(html);
      setMessages([...newMessages, { role: "assistant", content: "Done." }]);
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
    updateCurrentSlide(html);
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

  return (
    <div className="app">
      <ThumbnailPanel
        slides={slides}
        currentIndex={currentSlideIndex}
        onSelect={handleGoToSlide}
        onAdd={handleAddSlide}
        onDelete={handleDeleteSlide}
      />
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

import { useCallback, useMemo } from "react";
import type { Slide, SlideSource } from "../types";
import { cloneSlideWithNewId } from "../slideUtils";

function createEmptySource(): SlideSource {
  return { background: { type: "none" }, elements: [] };
}

function createSlide(): Slide {
  return { id: crypto.randomUUID(), html: "", source: createEmptySource() };
}

export interface UseSlideOperationsOptions {
  slides: Slide[];
  currentSlideIndex: number;
  setSlides: React.Dispatch<React.SetStateAction<Slide[]>>;
  setCurrentSlideIndex: (index: number) => void;
}

export interface UseSlideOperationsResult {
  currentSlide: Slide;
  handleAddSlide: () => void;
  handleDeleteSlide: (index: number) => void;
  handleDuplicateSlide: () => void;
  handleGoToSlide: (index: number) => void;
  handlePrevSlide: () => void;
  handleNextSlide: () => void;
  handleFirstSlide: () => void;
  handleLastSlide: () => void;
}

export function useSlideOperations({
  slides,
  currentSlideIndex,
  setSlides,
  setCurrentSlideIndex,
}: UseSlideOperationsOptions): UseSlideOperationsResult {
  const currentSlide = useMemo(
    () => slides[currentSlideIndex],
    [slides, currentSlideIndex]
  );

  const handleAddSlide = useCallback(() => {
    const newSlide = createSlide();
    setSlides((prev) => [
      ...prev.slice(0, currentSlideIndex + 1),
      newSlide,
      ...prev.slice(currentSlideIndex + 1),
    ]);
    setCurrentSlideIndex(currentSlideIndex + 1);
  }, [currentSlideIndex, setSlides, setCurrentSlideIndex]);

  const handleDeleteSlide = useCallback(
    (index: number) => {
      if (slides.length <= 1) return;
      setSlides((prev) => prev.filter((_, i) => i !== index));
      if (index <= currentSlideIndex && currentSlideIndex > 0) {
        setCurrentSlideIndex(currentSlideIndex - 1);
      }
    },
    [slides.length, currentSlideIndex, setSlides, setCurrentSlideIndex]
  );

  const handleDuplicateSlide = useCallback(() => {
    const slideToDuplicate = slides[currentSlideIndex];
    if (!slideToDuplicate) return;
    const duplicated = cloneSlideWithNewId(slideToDuplicate, crypto.randomUUID());
    setSlides((prev) => {
      const next = [...prev];
      next.splice(currentSlideIndex + 1, 0, duplicated);
      return next;
    });
    setCurrentSlideIndex(currentSlideIndex + 1);
  }, [slides, currentSlideIndex, setSlides, setCurrentSlideIndex]);

  const handleGoToSlide = useCallback(
    (index: number) => {
      if (index >= 0 && index < slides.length) {
        setCurrentSlideIndex(index);
      }
    },
    [slides.length, setCurrentSlideIndex]
  );

  const handlePrevSlide = useCallback(() => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1);
    }
  }, [currentSlideIndex, setCurrentSlideIndex]);

  const handleNextSlide = useCallback(() => {
    if (currentSlideIndex < slides.length - 1) {
      setCurrentSlideIndex(currentSlideIndex + 1);
    }
  }, [currentSlideIndex, slides.length, setCurrentSlideIndex]);

  const handleFirstSlide = useCallback(() => {
    setCurrentSlideIndex(0);
  }, [setCurrentSlideIndex]);

  const handleLastSlide = useCallback(() => {
    setCurrentSlideIndex(slides.length - 1);
  }, [slides.length, setCurrentSlideIndex]);

  return {
    currentSlide,
    handleAddSlide,
    handleDeleteSlide,
    handleDuplicateSlide,
    handleGoToSlide,
    handlePrevSlide,
    handleNextSlide,
    handleFirstSlide,
    handleLastSlide,
  };
}

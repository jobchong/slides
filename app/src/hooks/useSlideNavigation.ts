import { useEffect } from "react";

interface UseSlideNavigationOptions {
  onPrev: () => void;
  onNext: () => void;
  onFirst: () => void;
  onLast: () => void;
  onAdd: () => void;
  onDelete: () => void;
}

export function useSlideNavigation({
  onPrev,
  onNext,
  onFirst,
  onLast,
  onAdd,
  onDelete,
}: UseSlideNavigationOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
        case "ArrowUp":
          e.preventDefault();
          onPrev();
          break;
        case "ArrowRight":
        case "ArrowDown":
          e.preventDefault();
          onNext();
          break;
        case "Home":
          e.preventDefault();
          onFirst();
          break;
        case "End":
          e.preventDefault();
          onLast();
          break;
        case "m":
          if (e.metaKey || e.ctrlKey) {
            e.preventDefault();
            onAdd();
          }
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          onDelete();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onPrev, onNext, onFirst, onLast, onAdd, onDelete]);
}

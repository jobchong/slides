import { useRef, useCallback, useEffect } from "react";

/**
 * Hook to save and restore focus when opening/closing modals or dialogs.
 * Call saveFocus() before opening, restoreFocus() after closing.
 */
export function useFocusReturn() {
  const savedElementRef = useRef<HTMLElement | null>(null);

  const saveFocus = useCallback(() => {
    savedElementRef.current = document.activeElement as HTMLElement;
  }, []);

  const restoreFocus = useCallback(() => {
    if (savedElementRef.current && typeof savedElementRef.current.focus === "function") {
      // Small delay to ensure DOM has updated
      requestAnimationFrame(() => {
        savedElementRef.current?.focus();
        savedElementRef.current = null;
      });
    }
  }, []);

  return { saveFocus, restoreFocus };
}

/**
 * Hook that automatically saves focus on mount and restores on unmount.
 * Useful for modal components.
 */
export function useAutoFocusReturn(isOpen: boolean) {
  const savedElementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      savedElementRef.current = document.activeElement as HTMLElement;
    } else if (savedElementRef.current) {
      requestAnimationFrame(() => {
        savedElementRef.current?.focus();
        savedElementRef.current = null;
      });
    }
  }, [isOpen]);
}

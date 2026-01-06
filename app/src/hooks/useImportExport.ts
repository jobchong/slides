import { useState, useRef, useCallback } from "react";
import type { Slide } from "../types";
import { exportDeck, importPptx, type ImportProgress } from "../api";
import { sanitizeHtml } from "../sanitize";

export interface UseImportExportOptions {
  slides: Slide[];
  setSlides: React.Dispatch<React.SetStateAction<Slide[]>>;
  setCurrentSlideIndex: (index: number) => void;
  setMessages: (messages: []) => void;
}

export interface UseImportExportResult {
  isImporting: boolean;
  isExporting: boolean;
  importProgress: ImportProgress | null;
  importExportError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement>;
  handleImportClick: () => void;
  handleExportClick: () => Promise<void>;
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleImportCancel: () => void;
  clearImportExportError: () => void;
}

export function useImportExport({
  slides,
  setSlides,
  setCurrentSlideIndex,
  setMessages,
}: UseImportExportOptions): UseImportExportResult {
  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [importExportError, setImportExportError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importAbortRef = useRef(false);
  const importControllerRef = useRef<AbortController | null>(null);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleExportClick = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);
    setImportExportError(null);
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
      setImportExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, slides]);

  const handleImportCancel = useCallback(() => {
    importAbortRef.current = true;
    importControllerRef.current?.abort();
    importControllerRef.current = null;
    setIsImporting(false);
    setImportProgress(null);
  }, []);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // Reset the input so the same file can be selected again
      e.target.value = "";

      setIsImporting(true);
      setImportProgress({ type: "progress", status: "Starting import..." });
      importAbortRef.current = false;
      importControllerRef.current = new AbortController();

      const initialSlideCount = slides.length;
      const replacingEmptySlide = initialSlideCount === 1 && slides[0].html === "";
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
          setImportExportError(err instanceof Error ? err.message : "Import failed");
        }
      } finally {
        importControllerRef.current = null;
        setIsImporting(false);
        setImportProgress(null);
      }
    },
    [slides, setSlides, setCurrentSlideIndex, setMessages]
  );

  const clearImportExportError = useCallback(() => {
    setImportExportError(null);
  }, []);

  return {
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
  };
}

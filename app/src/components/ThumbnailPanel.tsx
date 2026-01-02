import { useRef, useEffect } from "react";
import type { Slide } from "../types";
import { SlideThumbnail } from "./SlideThumbnail";
import "./ThumbnailPanel.css";

interface ThumbnailPanelProps {
  slides: Slide[];
  currentIndex: number;
  onSelect: (index: number) => void;
  onAdd: () => void;
  onDelete: (index: number) => void;
  onDuplicate: () => void;
  onNewDeck: () => void;
  onExport: () => void;
  onImport: () => void;
  isImporting: boolean;
  isExporting: boolean;
}

export function ThumbnailPanel({
  slides,
  currentIndex,
  onSelect,
  onAdd,
  onDelete,
  onDuplicate,
  onNewDeck,
  onExport,
  onImport,
  isImporting,
  isExporting,
}: ThumbnailPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const canDelete = slides.length > 1;

  // Scroll to keep selected thumbnail visible
  useEffect(() => {
    if (!listRef.current) return;
    const container = listRef.current;
    const selected = container.children[currentIndex] as HTMLElement;
    if (!selected) return;

    const containerRect = container.getBoundingClientRect();
    const selectedRect = selected.getBoundingClientRect();

    if (selectedRect.top < containerRect.top) {
      selected.scrollIntoView({ block: "start", behavior: "smooth" });
    } else if (selectedRect.bottom > containerRect.bottom) {
      selected.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [currentIndex]);

  return (
    <div className="thumbnail-panel" role="region" aria-label="Slide management">
      <div
        className="thumbnail-panel-list"
        ref={listRef}
        role="listbox"
        aria-label="Slide thumbnails"
      >
        {slides.map((slide, index) => (
          <SlideThumbnail
            key={slide.id}
            slide={slide}
            index={index}
            isSelected={index === currentIndex}
            onClick={() => onSelect(index)}
            onDelete={() => onDelete(index)}
            canDelete={canDelete}
          />
        ))}
      </div>
      <div className="thumbnail-panel-actions" role="toolbar" aria-label="Slide actions">
        <button
          className="thumbnail-panel-add"
          onClick={onAdd}
          aria-label="Add new slide after current"
        >
          + Add Slide
        </button>
        <button
          className="thumbnail-panel-duplicate"
          onClick={onDuplicate}
          aria-label="Duplicate current slide"
        >
          Duplicate Slide
        </button>
        <button
          className="thumbnail-panel-new"
          onClick={onNewDeck}
          aria-label="Create new empty deck"
        >
          New Deck
        </button>
        <button
          className="thumbnail-panel-export"
          onClick={onExport}
          disabled={isExporting}
          aria-label="Export deck as PowerPoint file"
          aria-busy={isExporting}
        >
          {isExporting ? (
            <>
              <span className="button-spinner" aria-hidden="true" />
              Exporting...
            </>
          ) : (
            "Export PPTX"
          )}
        </button>
        <button
          className="thumbnail-panel-import"
          onClick={onImport}
          disabled={isImporting}
          aria-label="Import PowerPoint file"
          aria-busy={isImporting}
        >
          {isImporting ? "Importing..." : "Import PPTX"}
        </button>
      </div>
    </div>
  );
}

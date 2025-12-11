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
}

export function ThumbnailPanel({
  slides,
  currentIndex,
  onSelect,
  onAdd,
  onDelete,
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
    <div className="thumbnail-panel">
      <div className="thumbnail-panel-list" ref={listRef}>
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
      <button className="thumbnail-panel-add" onClick={onAdd}>
        + Add Slide
      </button>
    </div>
  );
}

import type { MouseEvent, KeyboardEvent } from "react";
import type { Slide } from "../types";
import "./SlideThumbnail.css";

interface SlideThumbnailProps {
  slide: Slide;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  onDelete: () => void;
  canDelete: boolean;
}

export function SlideThumbnail({
  slide,
  index,
  isSelected,
  onClick,
  onDelete,
  canDelete,
}: SlideThumbnailProps) {
  const handleDeleteClick = (e: MouseEvent) => {
    e.stopPropagation();
    onDelete();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={`slide-thumbnail ${isSelected ? "slide-thumbnail--selected" : ""}`}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role="option"
      tabIndex={0}
      aria-selected={isSelected}
      aria-label={`Slide ${index + 1}${isSelected ? ", selected" : ""}`}
    >
      <div className="slide-thumbnail-preview">
        {slide.html ? (
          <div className="slide-thumbnail-content">
            <div
              className="slide-thumbnail-inner"
              dangerouslySetInnerHTML={{ __html: slide.html }}
            />
          </div>
        ) : (
          <div className="slide-thumbnail-empty" />
        )}
        {canDelete && (
          <button
            className="slide-thumbnail-delete"
            onClick={handleDeleteClick}
            aria-label={`Delete slide ${index + 1}`}
          >
            ×
          </button>
        )}
      </div>
      <span className="slide-thumbnail-number">{index + 1}</span>
    </div>
  );
}

import type { MouseEvent } from "react";
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

  return (
    <div
      className={`slide-thumbnail ${isSelected ? "slide-thumbnail--selected" : ""}`}
      onClick={onClick}
    >
      <div className="slide-thumbnail-preview">
        {slide.html ? (
          <div
            className="slide-thumbnail-content"
            dangerouslySetInnerHTML={{ __html: slide.html }}
          />
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

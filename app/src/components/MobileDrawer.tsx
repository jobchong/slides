import { useRef, useEffect } from "react";
import type { Slide } from "../types";
import type { Theme } from "../hooks/useTheme";
import { SlideThumbnail } from "./SlideThumbnail";
import { ThemeToggle } from "./ThemeToggle";
import "./MobileDrawer.css";

interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
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
  theme: Theme;
  onThemeCycle: () => void;
}

export function MobileDrawer({
  isOpen,
  onClose,
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
  theme,
  onThemeCycle,
}: MobileDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const canDelete = slides.length > 1;

  // Close on escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Trap focus inside drawer
  useEffect(() => {
    if (!isOpen || !drawerRef.current) return;

    const focusableElements = drawerRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    firstElement?.focus();

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };

    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [isOpen]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const handleSelectSlide = (index: number) => {
    onSelect(index);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="mobile-drawer-overlay" onClick={onClose}>
      <div
        ref={drawerRef}
        className="mobile-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Slide navigation"
      >
        <div className="mobile-drawer-header">
          <h2 className="mobile-drawer-title">Slides</h2>
          <button
            className="mobile-drawer-close"
            onClick={onClose}
            aria-label="Close drawer"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="mobile-drawer-list" role="listbox" aria-label="Slide thumbnails">
          {slides.map((slide, index) => (
            <SlideThumbnail
              key={slide.id}
              slide={slide}
              index={index}
              isSelected={index === currentIndex}
              onClick={() => handleSelectSlide(index)}
              onDelete={() => onDelete(index)}
              canDelete={canDelete}
            />
          ))}
        </div>

        <div className="mobile-drawer-actions" role="toolbar" aria-label="Slide actions">
          <button className="mobile-drawer-btn" onClick={onAdd}>
            + Add Slide
          </button>
          <button className="mobile-drawer-btn" onClick={onDuplicate}>
            Duplicate
          </button>
          <button className="mobile-drawer-btn" onClick={onNewDeck}>
            New Deck
          </button>
          <button
            className="mobile-drawer-btn"
            onClick={onExport}
            disabled={isExporting}
          >
            {isExporting ? "Exporting..." : "Export"}
          </button>
          <button
            className="mobile-drawer-btn"
            onClick={onImport}
            disabled={isImporting}
          >
            {isImporting ? "Importing..." : "Import"}
          </button>
        </div>
        <div className="mobile-drawer-theme">
          <ThemeToggle theme={theme} onCycle={onThemeCycle} />
        </div>
      </div>
    </div>
  );
}

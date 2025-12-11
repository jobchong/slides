import "./SlideNavigation.css";

interface SlideNavigationProps {
  currentIndex: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}

export function SlideNavigation({
  currentIndex,
  total,
  onPrev,
  onNext,
}: SlideNavigationProps) {
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === total - 1;

  return (
    <div className="slide-navigation">
      <button
        className="slide-navigation-btn"
        onClick={onPrev}
        disabled={isFirst}
        aria-label="Previous slide"
      >
        ‹ Prev
      </button>
      <span className="slide-navigation-indicator">
        {currentIndex + 1} / {total}
      </span>
      <button
        className="slide-navigation-btn"
        onClick={onNext}
        disabled={isLast}
        aria-label="Next slide"
      >
        Next ›
      </button>
    </div>
  );
}

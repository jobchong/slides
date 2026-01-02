import "./SlideView.css";

interface SlideViewProps {
  html: string;
  isLoading?: boolean;
}

export function SlideView({ html, isLoading }: SlideViewProps) {
  return (
    <div className="slide" role="img" aria-label="Slide preview">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {isLoading && (
        <div
          className="slide-loading"
          role="status"
          aria-live="polite"
          aria-label="Generating slide content"
        >
          <div className="slide-loading-spinner" aria-hidden="true" />
          <span className="slide-loading-text">Generating...</span>
        </div>
      )}
    </div>
  );
}

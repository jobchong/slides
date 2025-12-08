import "./SlideView.css";

interface SlideViewProps {
  html: string;
  isLoading?: boolean;
}

export function SlideView({ html, isLoading }: SlideViewProps) {
  return (
    <div className="slide">
      <div dangerouslySetInnerHTML={{ __html: html }} />
      {isLoading && (
        <div className="slide-loading">
          <div className="slide-loading-spinner" />
        </div>
      )}
    </div>
  );
}

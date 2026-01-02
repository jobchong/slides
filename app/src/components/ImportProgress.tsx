import type { ImportProgress as ImportProgressType } from "../api";
import "./ImportProgress.css";

interface ImportProgressProps {
  progress: ImportProgressType | null;
  onCancel: () => void;
}

export function ImportProgress({ progress, onCancel }: ImportProgressProps) {
  if (!progress) return null;

  const percentage =
    progress.current && progress.total
      ? Math.round((progress.current / progress.total) * 100)
      : 0;

  return (
    <div
      className="import-progress-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-progress-title"
    >
      <div className="import-progress-modal">
        <div className="import-progress-header" id="import-progress-title">
          Importing Presentation
        </div>
        <div
          className="import-progress-status"
          role="status"
          aria-live="polite"
        >
          {progress.status || "Processing..."}
        </div>
        {progress.total && (
          <div
            className="import-progress-bar-container"
            role="progressbar"
            aria-valuenow={percentage}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Import progress: ${percentage}%`}
          >
            <div
              className="import-progress-bar"
              style={{ width: `${percentage}%` }}
            />
          </div>
        )}
        {progress.type === "error" && progress.error && (
          <div className="import-progress-error" role="alert">
            {progress.error}
          </div>
        )}
        <button
          className="import-progress-cancel"
          onClick={onCancel}
          aria-label="Cancel import"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

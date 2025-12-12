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
    <div className="import-progress-overlay">
      <div className="import-progress-modal">
        <div className="import-progress-header">Importing Presentation</div>
        <div className="import-progress-status">
          {progress.status || "Processing..."}
        </div>
        {progress.total && (
          <div className="import-progress-bar-container">
            <div
              className="import-progress-bar"
              style={{ width: `${percentage}%` }}
            />
          </div>
        )}
        {progress.type === "error" && progress.error && (
          <div className="import-progress-error">{progress.error}</div>
        )}
        <button className="import-progress-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

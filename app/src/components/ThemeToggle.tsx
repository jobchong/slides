import type { Theme } from "../hooks/useTheme";
import "./ThemeToggle.css";

interface ThemeToggleProps {
  theme: Theme;
  onCycle: () => void;
}

const THEME_ICONS: Record<Theme, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};

export function ThemeToggle({ theme, onCycle }: ThemeToggleProps) {
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={onCycle}
      aria-label={`Theme: ${theme}. Click to change.`}
      title={`Theme: ${THEME_ICONS[theme]}`}
    >
      <span className={`theme-toggle-icon theme-toggle-icon--${theme}`} aria-hidden="true" />
      <span className="theme-toggle-label">{THEME_ICONS[theme]}</span>
    </button>
  );
}

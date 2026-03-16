import { useEffect, useRef, useState } from "react";
import "./Announcer.css";

interface AnnouncerProps {
  message: string;
  politeness?: "polite" | "assertive";
}

/**
 * Screen reader announcer component using ARIA live regions.
 * Announces messages to assistive technology without visual display.
 */
export function Announcer({ message, politeness = "polite" }: AnnouncerProps) {
  const [announcement, setAnnouncement] = useState("");
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!message) return;

    // Clear previous timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    // Clear then set to trigger re-announcement of same message
    setAnnouncement("");
    timeoutRef.current = window.setTimeout(() => {
      setAnnouncement(message);
    }, 100);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [message]);

  return (
    <div
      className="announcer"
      role="status"
      aria-live={politeness}
      aria-atomic="true"
    >
      {announcement}
    </div>
  );
}

import { useState, useRef, useEffect } from "react";
import type { ChangeEvent } from "react";
import type { Message } from "../types";
import { uploadImage } from "../uploads";
import "./ChatInput.css";

interface ChatInputProps {
  messages: Message[];
  onSend: (message: string) => void;
  isLoading: boolean;
  onUploadComplete: (url: string) => void;
}

type UploadStatus = "idle" | "uploading" | "done" | "error";

interface UploadItem {
  id: string;
  name: string;
  status: UploadStatus;
  url?: string;
  error?: string;
}

export function ChatInput({
  messages,
  onSend,
  isLoading,
  onUploadComplete,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);
  const hasPendingUpload = uploads.some((u) => u.status === "uploading");
  const isSendDisabled = isLoading || hasPendingUpload || input.trim().length === 0;
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (historyRef.current && isExpanded) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [messages, isExpanded]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSendDisabled) return;

    onSend(input.trim());
    setInput("");
    setIsExpanded(false);
  };

  const toggleHistory = () => {
    setIsExpanded((prev) => !prev);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const id = crypto.randomUUID();
    setUploads((prev) => [...prev, { id, name: file.name, status: "uploading" }]);

    try {
      const result = await uploadImage(file);
      setUploads((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: "done", url: result.url } : item
        )
      );
      onUploadComplete(result.url);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Upload failed. Please try again.";
      setUploads((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, status: "error", error: message } : item
        )
      );
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className={`chat-container ${isExpanded ? "chat-container--expanded" : ""}`}>
      {messages.length > 0 && (
        <button
          type="button"
          onClick={toggleHistory}
          className={`chat-toggle ${isExpanded ? "chat-toggle--expanded" : ""}`}
        >
          <span className={`chat-toggle-arrow ${isExpanded ? "chat-toggle-arrow--expanded" : ""}`}>
            ▲
          </span>
          {messages.length} message{messages.length !== 1 ? "s" : ""}
        </button>
      )}

      <div
        ref={historyRef}
        className={`chat-history ${isExpanded && messages.length > 0 ? "chat-history--open" : "chat-history--closed"}`}
      >
        {messages.map((message, i) => (
          <div
            key={i}
            className={`chat-message ${message.role === "user" ? "chat-message--user" : "chat-message--assistant"}`}
          >
            {message.content}
          </div>
        ))}
        {isLoading && <div className="chat-loading">Thinking...</div>}
      </div>

      <form onSubmit={handleSubmit} className="chat-form">
        <button
          type="button"
          className="chat-upload"
          onClick={handleUploadClick}
          aria-label="Add media"
          disabled={isLoading}
        >
          +
        </button>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={messages.length === 0 ? "Describe your slide..." : "Continue editing..."}
          disabled={isLoading}
          className="chat-input"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <button
          type="submit"
          className="chat-send"
          disabled={isSendDisabled}
          aria-label="Send message"
        >
          <span className="chat-send-arrow" aria-hidden="true" />
        </button>
      </form>
      {uploads.length > 0 && (
        <div className="chat-uploads">
          {uploads.map((upload) => (
            <div key={upload.id} className="chat-upload-row">
              <span className="chat-upload-name">{upload.name}</span>
              {upload.status === "uploading" && <span className="chat-upload-status">Uploading…</span>}
              {upload.status === "done" && upload.url && (
                <span className="chat-upload-status chat-upload-status--success">
                  Ready (added to chat)
                </span>
              )}
              {upload.status === "error" && (
                <span className="chat-upload-status chat-upload-status--error">{upload.error}</span>
              )}
            </div>
          ))}
          {hasPendingUpload && (
            <div className="chat-upload-hint">Finish upload to enable Send.</div>
          )}
        </div>
      )}
    </div>
  );
}

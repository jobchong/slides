import { useState, useRef, useEffect } from "react";
import type { ChangeEvent } from "react";
import type { Message } from "../types";
import { uploadImage } from "../uploads";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { sendVoiceMessage } from "../api";
import "./ChatInput.css";

interface ChatInputProps {
  messages: Message[];
  slideHtml: string;
  onSend: (message: string) => void;
  onVoiceMessage: (transcription: string, html: string) => void;
  isLoading: boolean;
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
  slideHtml,
  onSend,
  onVoiceMessage,
  isLoading,
}: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [isUploadMenuOpen, setIsUploadMenuOpen] = useState(false);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const historyRef = useRef<HTMLDivElement>(null);
  const uploadMenuRef = useRef<HTMLDivElement>(null);
  const hasPendingUpload = uploads.some((u) => u.status === "uploading");
  const completedUploads = uploads.filter((u) => u.status === "done" && u.url);
  const hasAttachedImages = completedUploads.length > 0;
  const isSendDisabled = isLoading || hasPendingUpload || (input.trim().length === 0 && !hasAttachedImages);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    recordingState,
    recordingDuration,
    error: audioError,
    isSupported: isAudioSupported,
    startRecording: startAudioRecording,
    stopRecording: stopAudioRecording,
    cancelRecording,
    setRecordingState,
    setError: setAudioError,
  } = useAudioRecorder();

  useEffect(() => {
    if (historyRef.current && isExpanded) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [messages, isExpanded]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant") return;

    const needsClarification =
      /\?/.test(lastMessage.content) ||
      /clarif/i.test(lastMessage.content) ||
      /need more/i.test(lastMessage.content) ||
      /unsure/i.test(lastMessage.content);

    if (needsClarification) {
      setIsExpanded(true);
    }
  }, [messages]);

  useEffect(() => {
    if (!isUploadMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (uploadMenuRef.current?.contains(event.target as Node)) return;
      setIsUploadMenuOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isUploadMenuOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSendDisabled) return;

    const baseMessage = input.trim();
    const attachmentContext = completedUploads.length
      ? `\n\nAttached images:\n${completedUploads.map((u) => `- ${u.url}`).join("\n")}`
      : "";
    const finalMessage = (baseMessage || "Attached images provided.") + attachmentContext;

    onSend(finalMessage);
    setInput("");
    setIsExpanded(false);
    setIsUploadMenuOpen(false);
    setUploads((prev) => prev.filter((item) => item.status !== "done"));
  };

  const toggleHistory = () => {
    setIsExpanded((prev) => !prev);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleUploadOption = () => {
    setIsUploadMenuOpen(false);
    handleUploadClick();
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

  const handleRemoveAttachment = (id: string) => {
    setUploads((prev) => prev.filter((item) => item.id !== id));
  };

  const handleMicrophoneClick = async () => {
    if (recordingState === "recording") {
      // Stop recording and send
      const audioBlob = await stopAudioRecording();
      if (audioBlob) {
        await handleVoiceMessageSend(audioBlob);
      }
    } else if (recordingState === "idle" || recordingState === "error") {
      // Start or restart after error
      setRecordingState("idle");
      setAudioError(null);
      await startAudioRecording();
    }
  };

  const handleVoiceMessageSend = async (audioBlob: Blob) => {
    try {
      setRecordingState("uploading");
      setAudioError(null);

      const { html, transcription } = await sendVoiceMessage(audioBlob, messages, slideHtml);

      setRecordingState("processing");
      onVoiceMessage(transcription, html);

      // Reset to idle after successful processing
      setRecordingState("idle");
    } catch (error) {
      console.error("Voice message error:", error);
      setRecordingState("error");
      setAudioError(error instanceof Error ? error.message : "Failed to process voice message");
    }
  };

  const handleCancelRecording = () => {
    cancelRecording();
    setRecordingState("idle");
    setAudioError(null);
  };

  // Handle ESC key to cancel recording
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && recordingState === "recording") {
        handleCancelRecording();
      }
    };

    if (recordingState === "recording") {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [recordingState]);

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

      {recordingState === "uploading" || recordingState === "processing" ? (
        <div className="chat-recording-status">
          {recordingState === "uploading" ? "Uploading audio..." : "Transcribing and generating..."}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="chat-form">
          <div className="chat-compose">
            {completedUploads.length > 0 && !recordingState.includes("recording") && (
              <div className="chat-attachments-inline" aria-label="Attached images">
                {completedUploads.map((upload) => (
                  <div className="chat-attachment-chip" key={upload.id}>
                    <img src={upload.url} alt={upload.name} className="chat-attachment-thumb" />
                    <button
                      type="button"
                      className="chat-attachment-remove"
                      onClick={() => handleRemoveAttachment(upload.id)}
                      aria-label={`Remove ${upload.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {recordingState === "recording" ? (
              <div className="chat-recording-inline">
                <div className="chat-recording-indicator">
                  <div className="chat-recording-dot" />
                  <span className="chat-recording-text">Listening...</span>
                  <span className="chat-recording-timer">
                    {Math.floor(recordingDuration / 60)}:{(recordingDuration % 60).toString().padStart(2, "0")}
                  </span>
                </div>
              </div>
            ) : (
              <div className="chat-input-row">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={messages.length === 0 ? "Describe your slide..." : "Continue editing..."}
                  disabled={isLoading}
                  className="chat-input"
                />
              </div>
            )}

            <div className="chat-actions">
              <div className="chat-actions-left">
                {recordingState !== "recording" && (
                  <div className="chat-upload-wrapper" ref={uploadMenuRef}>
                    <button
                      type="button"
                      className={`chat-upload-toggle ${isUploadMenuOpen ? "chat-upload-toggle--open" : ""}`}
                      onClick={() => setIsUploadMenuOpen((prev) => !prev)}
                      aria-haspopup="menu"
                      aria-expanded={isUploadMenuOpen}
                      aria-label="Add attachment"
                      disabled={isLoading}
                    >
                      <span className="chat-upload-plus" aria-hidden="true">
                        +
                      </span>
                    </button>
                    {isUploadMenuOpen && (
                      <div className="chat-upload-menu" role="menu">
                        <button
                          type="button"
                          className="chat-upload-menu-item"
                          role="menuitem"
                          onClick={handleUploadOption}
                        >
                          Upload image
                        </button>
                        <div className="chat-upload-menu-note">More formats soon</div>
                      </div>
                    )}
                  </div>
                )}
                {recordingState === "recording" && (
                  <button
                    type="button"
                    className="chat-recording-cancel-btn"
                    onClick={handleCancelRecording}
                    aria-label="Cancel recording"
                  >
                    Cancel
                  </button>
                )}
                {uploads.some((upload) => upload.status !== "done") && (
                  <div className="chat-upload-inline">
                    {uploads
                      .filter((upload) => upload.status !== "done")
                      .map((upload) => (
                        <span key={upload.id} className="chat-upload-inline-item">
                          {upload.name} {upload.status === "uploading" ? "· Uploading…" : ""}
                          {upload.status === "error" && (
                            <span className="chat-upload-inline-error"> · {upload.error}</span>
                          )}
                        </span>
                      ))}
                  </div>
                )}
                {hasPendingUpload && <div className="chat-upload-hint">Finish upload to enable Send.</div>}
              </div>

              <div className="chat-actions-right">
                {isAudioSupported && (
                  <button
                    type="button"
                    className={`chat-mic ${recordingState === "recording" ? "chat-mic--recording" : ""}`}
                    onClick={handleMicrophoneClick}
                    disabled={isLoading}
                    aria-label={recordingState === "recording" ? "Stop recording and send" : "Start voice input"}
                  >
                    {recordingState === "recording" ? (
                      <span className="chat-mic-text">Stop</span>
                    ) : (
                      <span className="chat-mic-icon" aria-hidden="true" />
                    )}
                  </button>
                )}
                {recordingState !== "recording" && (
                  <button
                    type="submit"
                    className="chat-send"
                    disabled={isSendDisabled}
                    aria-label="Send message"
                  >
                    <span className="chat-send-icon" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </form>
      )}
      {audioError && (
        <div className="chat-speech-error">
          <span>{audioError}</span>
          <button
            type="button"
            className="chat-speech-reset"
            onClick={() => {
              setRecordingState("idle");
              setAudioError(null);
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

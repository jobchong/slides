import { useState } from "react";
import type { Message } from "./types";
import { SlideView } from "./components/SlideView";
import { ChatInput } from "./components/ChatInput";
import { callModel } from "./api";
import { MODEL_OPTIONS } from "./models";
import "./App.css";

export default function App() {
  const [slideHtml, setSlideHtml] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialModel =
    import.meta.env.VITE_DEFAULT_MODEL || MODEL_OPTIONS[0].value;
  const [model, setModel] = useState(initialModel);

  const handleSend = async (userMessage: string) => {
    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: userMessage },
    ];
    setMessages(newMessages);
    setIsLoading(true);
    setError(null);

    try {
      const html = await callModel(newMessages, slideHtml, model);
      setSlideHtml(html);
      setMessages([...newMessages, { role: "assistant", content: "Done." }]);
    } catch (err) {
      console.error("Error calling model:", err);
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVoiceMessage = (transcription: string, html: string) => {
    setMessages([
      ...messages,
      { role: "user", content: transcription },
      { role: "assistant", content: "Done." },
    ]);
    setSlideHtml(html);
  };

  return (
    <div className="app">
      <div className="app-slide-container">
        <SlideView html={slideHtml} isLoading={isLoading} />
      </div>
      <div className="app-chat">
        <ChatInput
          messages={messages}
          slideHtml={slideHtml}
          onSend={handleSend}
          onVoiceMessage={handleVoiceMessage}
          isLoading={isLoading}
          model={model}
          onModelChange={setModel}
          error={error}
          onErrorDismiss={() => setError(null)}
        />
      </div>
    </div>
  );
}

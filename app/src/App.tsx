import { useState } from "react";
import type { Message } from "./types";
import { SlideView } from "./components/SlideView";
import { ChatInput } from "./components/ChatInput";
import { callClaude } from "./api";
import "./App.css";

export default function App() {
  const [slideHtml, setSlideHtml] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = async (userMessage: string) => {
    const newMessages: Message[] = [
      ...messages,
      { role: "user", content: userMessage },
    ];
    setMessages(newMessages);
    setIsLoading(true);

    try {
      const html = await callClaude(newMessages, slideHtml);
      setSlideHtml(html);
      setMessages([...newMessages, { role: "assistant", content: "Done." }]);
    } catch (error) {
      console.error("Error calling Claude:", error);
      setMessages([
        ...newMessages,
        { role: "assistant", content: `Error: ${error instanceof Error ? error.message : "Unknown error"}` },
      ]);
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
        />
      </div>
    </div>
  );
}

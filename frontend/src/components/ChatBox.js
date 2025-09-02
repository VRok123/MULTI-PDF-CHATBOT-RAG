// src/components/ChatBox.js
import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import VoiceInput from "./VoiceInput";
import VoiceOutput from "./VoiceOutput";
import { API_BASE_URL, apiStream, apiFetch } from "../config";

function ChatBox({ sessionId, sessionToken }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [highlightedSource, setHighlightedSource] = useState(null);

  // Load saved messages when sessionId changes
  useEffect(() => {
    const fetchChat = async () => {
      if (!sessionId || !sessionToken) return;

      try {
        const data = await apiFetch(`/chat-messages/${sessionId}`, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });

        const parsed = (data.messages || []).map(m => ({
          ...m,
          timestamp: m.created_at ? new Date(m.created_at) : new Date(),
        }));

        setMessages(parsed);
      } catch (err) {
        console.error("Failed to load saved chat messages", err);
      }
    };

    fetchChat();
  }, [sessionId, sessionToken]);

  const handleAsk = async () => {
    if (!sessionId) {
      alert("Please upload PDFs or load a session first!");
      return;
    }
    if (!question.trim()) return;

    const newMessage = { sender: "You", text: question, timestamp: new Date() };
    setMessages(prev => [...prev, newMessage]);
    setLoading(true);

    try {
      const response = await apiStream('/ask', {
        method: "POST",
        body: JSON.stringify({ question, session_id: sessionId }),
        headers: { "Authorization": `Bearer ${sessionToken}` }
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      let botMessage = { sender: "AI", text: "", citations: [], timestamp: new Date() };
      setMessages(prev => [...prev, botMessage]);

      let buffer = "";
      let citationsData = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        if (buffer.includes("---__CITATIONS__---")) {
          const parts = buffer.split("---__CITATIONS__---");
          botMessage.text = parts[0] || "";
          citationsData = parts[1]?.trim() || "";
          break;
        }

        botMessage.text = buffer;
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...botMessage };
          return updated;
        });

        await new Promise(resolve => setTimeout(resolve, 10));
      }

      if (citationsData) {
        try {
          botMessage.citations = JSON.parse(citationsData);
        } catch (e) {
          console.error("Failed to parse citations", e);
        }
      }

      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...botMessage };
        return updated;
      });

    } catch (err) {
      console.error("Error asking question:", err);
      setMessages(prev => [
        ...prev,
        { sender: "AI", text: `Error: ${err.message}`, citations: [], timestamp: new Date() },
      ]);
    } finally {
      setLoading(false);
      setQuestion("");
    }
  };

  const handleSaveChat = async () => {
    if (!sessionId || messages.length === 0) {
      alert("No chat history to save.");
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/save-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          session_id: sessionId,
          messages: messages.map(m => ({
            sender: m.sender,
            text: m.text,
            citations: m.citations || []
          }))
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to save chat: ${response.status} ${errorText}`);
      }

      alert("Chat saved successfully!");
    } catch (err) {
      console.error("Error saving chat:", err);
      alert(`Error saving chat: ${err.message}`);
    }
  };

  const clearChat = () => {
    if (window.confirm("Are you sure you want to clear the chat?")) setMessages([]);
  };

  return (
    <div className="flex flex-col h-[600px]">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-semibold">Chat with your PDFs</h3>
        <div className="flex gap-2">
          <button onClick={clearChat} className="px-3 py-1 bg-gray-500 text-white rounded text-sm">Clear</button>
          <button onClick={handleSaveChat} disabled={!sessionToken || messages.length===0}
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50">
            Save
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto border rounded-lg p-4 mb-4 bg-gray-50 dark:bg-gray-700">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
            <div className="text-center">
              <div className="text-4xl mb-2">💬</div>
              <p>No messages yet. Ask a question to get started!</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg, idx) => (
              <div key={idx} className={`p-4 rounded-lg max-w-3xl ${msg.sender==="You"?"bg-blue-100 dark:bg-blue-900 ml-auto":"bg-white dark:bg-gray-600 mr-auto"}`}>
                <div className="flex justify-between items-start mb-2">
                  <strong className="text-sm">{msg.sender}:</strong>
                  <span className="text-xs text-gray-500">{msg.timestamp.toLocaleTimeString()}</span>
                </div>

                <div className="prose prose-sm max-w-none dark:prose-invert overflow-x-auto">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.text}
                  </ReactMarkdown>
                </div>

                {msg.sender==="AI" && msg.citations?.length>0 && (
                  <div className="mt-3 pt-3 border-t border-gray-300 dark:border-gray-500">
                    <strong className="text-sm block mb-2">📚 Sources:</strong>
                    <ul className="text-xs space-y-2">
                      {msg.citations.map((c,i)=>(
                        <li key={i} className="bg-yellow-50 dark:bg-yellow-900/30 p-2 rounded">
                          <span className="cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
                                onClick={()=>setHighlightedSource(c)}
                                title="Click to view full text">
                            <strong>{c.source}</strong> (p.{c.page}) – {c.preview.slice(0,120)}...
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {msg.sender==="AI" && (
                  <div className="mt-2 flex justify-end">
                    <VoiceOutput text={msg.text} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <VoiceInput setQuestion={setQuestion} />
        <input
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          onKeyDown={e => e.key==="Enter" && handleAsk()}
          placeholder="Type your question..."
          className="flex-1 p-2 rounded border dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
        />
        <button
          onClick={handleAsk}
          disabled={loading || !question.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50"
        >
          {loading ? "Asking..." : "Ask"}
        </button>
      </div>
    </div>
  );
}

export default ChatBox;

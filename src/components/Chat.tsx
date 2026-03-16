"use client";

import { useState, useRef, useEffect } from "react";

interface Source {
  content: string;
  relevance: number;
  metadata: Record<string, unknown>;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

const SUGGESTED = [
  "What projects has Volodymyr built?",
  "What tech stack does InkBot use?",
  "Show me the NiFTa smart contract code",
  "What is Volodymyr's experience with AWS?",
];

const PIPELINE_STEPS = [
  "Ingest & Chunk",
  "Jina Embed (1024d)",
  "pgvector + GIN",
  "Hybrid Search",
  "RRF Fusion",
  "Rerank",
  "LLM Stream",
];

const STACK = {
  Frontend: ["Next.js 16", "React 19", "TypeScript", "Tailwind v4", "SSE Streaming"],
  "Backend & AI": ["Supabase pgvector", "Jina Embeddings v3", "Jina Reranker v3", "DeepSeek (OpenRouter)", "Hybrid Search (RRF)"],
  Infrastructure: ["AWS EC2", "Nginx + SSL", "PM2 Cluster", "GitHub Actions CI/CD", "Standalone Build (~30MB)"],
};

function Sidebar({ onNewChat, hasMessages, sidebarOpen, onClose }: {
  onNewChat: () => void;
  hasMessages: boolean;
  sidebarOpen: boolean;
  onClose: () => void;
}) {
  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`
        fixed lg:static inset-y-0 left-0 z-40
        w-80 bg-gray-50 border-r border-gray-200
        flex flex-col h-screen overflow-y-auto
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `}>
        {/* Logo & Title */}
        <div className="px-5 pt-6 pb-4">
          <div className="flex items-center gap-2.5">
            <svg width="32" height="32" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
              <circle cx="32" cy="32" r="30" stroke="#2563EB" strokeWidth="4" />
              <path d="M24 22C24 17.6 27.6 14 32 14C36.4 14 40 17.6 40 22C40 26.4 36.4 30 32 30V38" stroke="#2563EB" strokeWidth="4" strokeLinecap="round" />
              <circle cx="32" cy="47" r="3" fill="#2563EB" />
            </svg>
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">
              Ask About Dorosh
            </h1>
          </div>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed">
            Production RAG system indexing 16 projects, full source code &amp; CV.
            Ask anything to explore Volodymyr&apos;s engineering skills.
          </p>
        </div>

        {/* Pipeline */}
        <div className="px-5 py-3 border-t border-gray-200">
          <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
            RAG Pipeline
          </h2>
          <div className="flex flex-col gap-1 text-xs">
            {PIPELINE_STEPS.map((step, i, arr) => (
              <div key={step} className="flex items-center gap-1.5">
                <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium whitespace-nowrap">
                  {step}
                </span>
                {i < arr.length - 1 && <span className="text-gray-300">↓</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Tech Stack */}
        <div className="px-5 py-3 border-t border-gray-200 flex-1">
          <h2 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Tech Stack
          </h2>
          <div className="space-y-3">
            {Object.entries(STACK).map(([title, items]) => (
              <div key={title}>
                <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{title}</h4>
                <ul className="text-xs text-gray-600 space-y-0.5">
                  {items.map((item) => (
                    <li key={item} className="flex items-start gap-1">
                      <span className="text-blue-400 mt-px shrink-0">•</span>{item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Stats + New Chat */}
        <div className="px-5 py-3 border-t border-gray-200">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400 mb-3">
            <span><strong className="text-gray-600">16</strong> projects</span>
            <span><strong className="text-gray-600">2,100+</strong> chunks</span>
            <span><strong className="text-gray-600">Full source</strong></span>
          </div>
          {hasMessages && (
            <button
              onClick={() => { onNewChat(); onClose(); }}
              className="w-full text-xs text-gray-500 hover:text-gray-700 border border-gray-300 hover:border-gray-400 rounded-lg px-3 py-2 transition-colors cursor-pointer"
            >
              New chat
            </button>
          )}
        </div>
      </aside>
    </>
  );
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function submitQuery(query: string) {
    if (!query.trim() || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: query }]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) {
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `Error: ${data.error}` },
        ]);
        return;
      }

      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        const data = await res.json();
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.answer, sources: data.sources },
        ]);
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let sources: Source[] = [];
      let buffer = "";

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", sources: [] },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;

          try {
            const json = JSON.parse(data);
            if (json.sources) {
              sources = json.sources;
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], sources };
                return updated;
              });
            }
            if (json.token) {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                updated[updated.length - 1] = { ...last, content: last.content + json.token };
                return updated;
              });
            }
          } catch {
            // skip malformed
          }
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to connect to the server." },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    submitQuery(input.trim());
  }

  const hasMessages = messages.length > 0;

  return (
    <div className="flex h-screen">
      <Sidebar
        onNewChat={() => setMessages([])}
        hasMessages={hasMessages}
        sidebarOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* Chat area */}
      <div className="flex-1 flex flex-col h-screen min-w-0">
        {/* Mobile header with burger */}
        <div className="lg:hidden flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer"
            aria-label="Open menu"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 5h14M3 10h14M3 15h14" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-gray-900">Ask About Dorosh</span>
        </div>

        {/* Messages / Welcome */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-5 py-6">
            {!hasMessages && (
              <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
                <svg width="48" height="48" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className="mb-4 opacity-30">
                  <circle cx="32" cy="32" r="30" stroke="#2563EB" strokeWidth="4" />
                  <path d="M24 22C24 17.6 27.6 14 32 14C36.4 14 40 17.6 40 22C40 26.4 36.4 30 32 30V38" stroke="#2563EB" strokeWidth="4" strokeLinecap="round" />
                  <circle cx="32" cy="47" r="3" fill="#2563EB" />
                </svg>
                <h2 className="text-lg font-semibold text-gray-700 mb-1">
                  Ask me anything
                </h2>
                <p className="text-sm text-gray-400 mb-6 max-w-sm">
                  About Volodymyr&apos;s projects, tech stack, experience, or source code
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTED.map((q) => (
                    <button
                      key={q}
                      onClick={() => submitQuery(q)}
                      className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors cursor-pointer"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                      msg.role === "user"
                        ? "bg-blue-600 text-white"
                        : "bg-gray-100 text-gray-900"
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-sm">{msg.content}</p>

                    {msg.sources && msg.sources.length > 0 && (
                      <details className="mt-2 text-xs">
                        <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                          {msg.sources.length} source(s) used
                        </summary>
                        <div className="mt-2 space-y-1.5">
                          {msg.sources.map((src, j) => (
                            <div
                              key={j}
                              className="bg-white border border-gray-200 rounded-lg p-2"
                            >
                              <span className="font-mono text-gray-400">
                                relevance: {src.relevance.toFixed(3)}
                              </span>
                              <p className="text-gray-600 mt-1">{src.content}</p>
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              ))}

              {loading && messages[messages.length - 1]?.role !== "assistant" && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl px-4 py-2.5 text-gray-500 text-sm">
                    Thinking...
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        {/* Input — bottom */}
        <div className="border-t border-gray-100 bg-white px-4 py-3">
          <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about projects, code, tech stack, experience..."
                className="flex-1 rounded-xl border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                Send
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "model";
  text: string;
}

const SUGGESTIONS = [
  "I'm having rice and curry — how many grams should I eat?",
  "What's a high-protein snack for right now?",
  "How do I hit my remaining protein today?",
];

// The AI Guru: a context-aware diet chat. The server attaches the user's goal +
// today's intake, so answers fit what's left in their day.
export function GuruChat({ name, onClose }: { name: string | null; onClose: () => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, busy]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || busy) return;
    const history = msgs.map((m) => ({ role: m.role, text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/guru", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const json = await res.json();
      setMsgs((m) => [...m, { role: "model", text: res.ok ? json.answer : json.error ?? "Try again." }]);
    } catch {
      setMsgs((m) => [...m, { role: "model", text: "Couldn't reach the Guru. Try again." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" style={{ display: "flex", flexDirection: "column", height: "82dvh" }}>
        <h3>✨ AI Guru</h3>

        <div style={{ flex: 1, overflowY: "auto", margin: "4px 0 12px" }}>
          {msgs.length === 0 && (
            <>
              <p className="muted" style={{ fontSize: 14 }}>
                Ask me anything about your diet{name ? `, ${name}` : ""}. I know today&apos;s intake and your goal.
              </p>
              <div className="pill-group" style={{ flexDirection: "column", alignItems: "stretch" }}>
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="pill" style={{ textAlign: "left", fontWeight: 500 }} onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </>
          )}
          {msgs.map((m, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  maxWidth: "82%",
                  padding: "10px 14px",
                  borderRadius: 16,
                  fontSize: 14,
                  lineHeight: 1.45,
                  whiteSpace: "pre-wrap",
                  background: m.role === "user" ? "var(--accent)" : "var(--surface)",
                  color: m.role === "user" ? "#fff" : "var(--ink)",
                }}
              >
                {m.text}
              </div>
            </div>
          ))}
          {busy && (
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div style={{ padding: "10px 14px", borderRadius: 16, background: "var(--surface)" }}>
                <span className="spinner" style={{ borderTopColor: "var(--accent)", borderColor: "var(--line)" }} />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="row" style={{ marginTop: 0 }}>
          <input
            className="field"
            value={input}
            placeholder="Ask the Guru…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send(input)}
            style={{ flex: 1 }}
          />
          <button className="btn btn-primary" style={{ flex: "none", width: "auto", padding: "14px 18px" }} disabled={busy || !input.trim()} onClick={() => send(input)}>
            Send
          </button>
        </div>
      </div>
    </>
  );
}

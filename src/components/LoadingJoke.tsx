"use client";

import { useEffect, useMemo, useState } from "react";
import { shuffledJokes } from "@/lib/jokes";

// A spinner + rotating fitness joke, for AI loading waits. Jokes cross-fade every
// few seconds so a longer analysis stays light instead of feeling stuck.
export function LoadingJoke({ label, intervalMs = 3500 }: { label?: string; intervalMs?: number }) {
  const jokes = useMemo(() => shuffledJokes(), []);
  const [i, setI] = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setShow(false);
      setTimeout(() => {
        setI((n) => (n + 1) % jokes.length);
        setShow(true);
      }, 250);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, jokes.length]);

  return (
    <div className="center-screen" style={{ gap: 20 }}>
      <span
        className="spinner"
        style={{ width: 28, height: 28, borderTopColor: "var(--accent)", borderColor: "var(--line)" }}
      />
      {label && <p className="muted" style={{ margin: 0 }}>{label}</p>}
      <p
        style={{
          maxWidth: 320,
          fontSize: 15,
          lineHeight: 1.5,
          color: "var(--ink)",
          opacity: show ? 1 : 0,
          transition: "opacity 0.25s var(--ease)",
          minHeight: 66,
        }}
      >
        {jokes[i]}
      </p>
    </div>
  );
}

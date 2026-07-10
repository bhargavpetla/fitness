"use client";

import { useEffect, useMemo, useState } from "react";
import { shuffledJokes } from "@/lib/jokes";

// A spinner + status label + a rotating fitness joke, for AI loading waits.
// The joke lives in its own fixed-height card that cross-fades on a stacked
// grid cell, so it never reflows the layout and can never visually merge with
// the status line above it or with the next joke.
export function LoadingJoke({ label, intervalMs = 4200 }: { label?: string; intervalMs?: number }) {
  const jokes = useMemo(() => shuffledJokes(), []);
  const [i, setI] = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    let swap: ReturnType<typeof setTimeout>;
    const id = setInterval(() => {
      setShow(false); // fade the current joke fully out first
      swap = setTimeout(() => {
        setI((n) => (n + 1) % jokes.length); // swap text only once it's invisible
        setShow(true); // then fade the new one in
      }, 420);
    }, intervalMs);
    return () => {
      clearInterval(id);
      clearTimeout(swap);
    };
  }, [intervalMs, jokes.length]);

  return (
    <div className="loading-joke">
      <span className="loading-joke-spinner spinner" />
      {label && <p className="loading-joke-label">{label}</p>}
      <div className="loading-joke-stage">
        <p className={`loading-joke-text ${show ? "in" : "out"}`}>{jokes[i]}</p>
      </div>
    </div>
  );
}

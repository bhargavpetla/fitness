"use client";

import type { AppMode } from "@/lib/mode";

// The Manual ⇄ AI Coach switch — chunky and springy, Duolingo-style. Appears
// only once the Coach is unlocked (7-day logging streak). The parent owns the
// wash transition; this is just the satisfying toggle.

export function ModeSwitch({ mode, onSwitch }: { mode: AppMode; onSwitch: (next: AppMode) => void }) {
  const ai = mode === "ai";
  return (
    <button
      className={`mode-switch ${ai ? "ai" : ""}`}
      role="switch"
      aria-checked={ai}
      aria-label={ai ? "Switch to manual tracking" : "Switch to AI Coach"}
      title={ai ? "Back to manual" : "AI Coach"}
      onClick={() => onSwitch(ai ? "manual" : "ai")}
    >
      <span className="mode-thumb" aria-hidden />
      <span className={`mode-opt ${!ai ? "on" : ""}`} aria-hidden>✍️</span>
      <span className={`mode-opt ${ai ? "on" : ""}`} aria-hidden>✨</span>
    </button>
  );
}

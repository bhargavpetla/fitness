"use client";

import { Icon } from "@/components/Icon";
import { fx } from "@/lib/fx";
import type { AppMode } from "@/lib/mode";

// The Manual ⇄ Coach switch — chunky and springy, with a proper flip sound.
// Appears only once the Coach is unlocked (7-day logging streak). The parent
// owns the wash transition; this is the satisfying toggle itself.

export function ModeSwitch({ mode, onSwitch }: { mode: AppMode; onSwitch: (next: AppMode) => void }) {
  const ai = mode === "ai";
  return (
    <button
      className={`mode-switch ${ai ? "ai" : ""}`}
      role="switch"
      aria-checked={ai}
      aria-label={ai ? "Switch to manual tracking" : "Switch to AI Coach"}
      title={ai ? "Back to manual" : "AI Coach"}
      onClick={() => {
        fx.switch();
        onSwitch(ai ? "manual" : "ai");
      }}
    >
      <span className="mode-thumb" aria-hidden />
      <span className={`mode-opt ${!ai ? "on" : ""}`} aria-hidden>
        <Icon name="create-outline" size={17} />
      </span>
      <span className={`mode-opt ${ai ? "on" : ""}`} aria-hidden>
        <Icon name="flash-outline" size={17} />
      </span>
    </button>
  );
}

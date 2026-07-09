"use client";

import { useEffect, useState } from "react";
import { MainApp } from "@/components/MainApp";
import { CoachHome } from "@/components/coach/CoachHome";
import { Icon } from "@/components/Icon";
import { fetchStreak } from "@/lib/db";
import { getMode, setMode, coachUnlocked, type AppMode } from "@/lib/mode";

// Decides which interface the app opens into. Manual is the default; once the
// user has earned the AI Coach (7-day streak) and switched to it, the app
// keeps opening into the Coach until they switch back. The switch itself plays
// a full-screen color wash — green into manual, violet into AI — with the
// interface swapping underneath at the wash's peak.

export function ModeGate() {
  const [mode, setModeState] = useState<AppMode | null>(null); // null = resolving
  const [unlocked, setUnlocked] = useState(false);
  const [wash, setWash] = useState<AppMode | null>(null);

  useEffect(() => {
    fetchStreak()
      .then((s) => {
        const u = coachUnlocked(s);
        setUnlocked(u);
        setModeState(u ? getMode() : "manual");
      })
      .catch(() => setModeState("manual"));
  }, []);

  function switchTo(next: AppMode) {
    setWash(next);
    // Swap the interface at the wash's peak so the new mode is revealed by it.
    setTimeout(() => {
      setMode(next);
      setModeState(next);
    }, 300);
    setTimeout(() => setWash(null), 700);
  }

  if (mode === null) {
    return (
      <div className="app-shell">
        <div className="center-screen">
          <span className="spinner" style={{ borderTopColor: "var(--accent)" }} />
        </div>
      </div>
    );
  }

  return (
    <>
      {wash && (
        <div className={`mode-wash ${wash}`} aria-hidden>
          <span className="mode-wash-icon" style={{ color: "#fff" }}>
            <Icon name={wash === "ai" ? "flash-outline" : "create-outline"} size={64} />
          </span>
        </div>
      )}
      {mode === "ai" ? (
        <CoachHome onSwitchMode={() => switchTo("manual")} />
      ) : (
        <MainApp coachAvailable={unlocked} onSwitchMode={() => switchTo("ai")} />
      )}
    </>
  );
}

"use client";

import { useEffect, useState } from "react";

// Macha, the app's pet — a Duolingo-style companion that shows up on empty
// states and milestones with a word of encouragement. Poses are generated once
// per user by the Gemini image model (via /api/images/generate, which skips
// keys that already exist in storage) and the signed URL is remembered in
// localStorage. If generation isn't available the pose falls back to an emoji
// tile, so the UI never looks broken.

export type MascotPose = "hello" | "cheer" | "flex" | "zen" | "sleep";

const FALLBACK: Record<MascotPose, string> = {
  hello: "👋",
  cheer: "🎉",
  flex: "💪",
  zen: "🧘",
  sleep: "😴",
};

// Signed URLs last 7 days; refresh a day early.
const TTL_MS = 6 * 24 * 60 * 60 * 1000;

export function Mascot({
  pose = "hello",
  size = 104,
  bubble,
}: {
  pose?: MascotPose;
  size?: number;
  bubble?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    const cacheKey = `mascot:${pose}`;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) ?? "null") as { url: string; t: number } | null;
      if (cached?.url && Date.now() - cached.t < TTL_MS) {
        setUrl(cached.url);
        return;
      }
    } catch {
      /* ignore bad cache */
    }
    fetch("/api/images/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ only: [`mascot-${pose}`] }),
    })
      .then((r) => r.json())
      .then((j) => {
        const u: string | null = j?.images?.[`mascot-${pose}`] ?? null;
        if (on && u) {
          setUrl(u);
          try {
            localStorage.setItem(cacheKey, JSON.stringify({ url: u, t: Date.now() }));
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {
        /* emoji fallback stays */
      });
    return () => {
      on = false;
    };
  }, [pose]);

  return (
    <div className="mascot">
      {bubble && <div className="mascot-bubble">{bubble}</div>}
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="mascot-img" src={url} width={size} height={size} alt="" />
      ) : (
        <span className="mascot-img mascot-ph" style={{ width: size, height: size, fontSize: size * 0.44 }}>
          {FALLBACK[pose]}
        </span>
      )}
    </div>
  );
}

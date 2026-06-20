"use client";

// Client helper for per-exercise illustrations. Resolves a cached image URL from
// the server (which generates once and stores permanently), and memoizes the
// result in localStorage keyed by exercise slug so re-opening a workout is
// instant and never re-triggers generation. Signed URLs expire, so we also store
// a timestamp and refetch lazily after a few days.

const TTL_MS = 1000 * 60 * 60 * 24 * 5; // refresh signed URL after ~5 days

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function cacheKey(name: string): string {
  return `eximg:${slug(name)}`;
}

const inflight = new Map<string, Promise<string | null>>();

export async function getExerciseImage(name: string, muscle?: string): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const key = cacheKey(name);

  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const { url, ts } = JSON.parse(raw) as { url: string | null; ts: number };
      if (url && Date.now() - ts < TTL_MS) return url;
    }
  } catch {
    /* ignore cache read errors */
  }

  if (inflight.has(key)) return inflight.get(key)!;

  const p = (async () => {
    try {
      const res = await fetch("/api/exercise/image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, muscle }),
      });
      const json = await res.json().catch(() => ({}));
      const url: string | null = json?.url ?? null;
      try {
        localStorage.setItem(key, JSON.stringify({ url, ts: Date.now() }));
      } catch {
        /* storage full / disabled — fine */
      }
      return url;
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

"use client";

import { useEffect } from "react";

// App-wide error boundary. Without one, a render error white-screens into Next's
// generic "client-side exception" page (what the user hit when switching Coach
// tabs). This catches it and offers a retry so one bad payload never traps them.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="app-shell">
      <div className="center-screen">
        <div style={{ fontSize: 40 }}>🌀</div>
        <h1 style={{ fontSize: 22, margin: 0 }}>That didn&apos;t go to plan</h1>
        <p className="muted" style={{ maxWidth: 320 }}>
          Something hiccuped while loading this screen. Your logged data is safe.
        </p>
        <button className="btn btn-primary" style={{ maxWidth: 220 }} onClick={() => reset()}>
          Try again
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PUBLIC_ENV, normalizeUrl } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

function LoginInner() {
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") ? "Sign-in failed. Please try again." : null
  );

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const appUrl = normalizeUrl(PUBLIC_ENV.siteUrl || window.location.origin);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${appUrl}/auth/callback`,
        // Always show the account chooser so switching accounts is easy.
        queryParams: { prompt: "select_account" },
      },
    });
    if (error) {
      setError("Could not start Google sign-in.");
      setBusy(false);
    }
    // On success the browser navigates to Google; no further code runs here.
  }

  return (
    <div className="app-shell">
      <div className="center-screen">
        <div style={{ fontSize: 40 }}>🍃</div>
        <h1 style={{ margin: 0, fontSize: 26, letterSpacing: "-0.02em" }}>Daily Intake</h1>
        <p className="muted" style={{ margin: "0 0 8px", maxWidth: 280 }}>
          Your private food and fitness tracker. Sign in to get started.
        </p>

        <button
          className="btn"
          style={{
            width: "100%",
            maxWidth: 320,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            background: "#fff",
            color: "var(--ink)",
            border: "1px solid var(--line)",
            boxShadow: "var(--shadow)",
          }}
          disabled={busy}
          onClick={signInWithGoogle}
        >
          {busy ? (
            <span className="spinner" style={{ borderTopColor: "var(--accent)", borderColor: "var(--line)" }} />
          ) : (
            <>
              <GoogleIcon />
              Continue with Google
            </>
          )}
        </button>

        {error && <p style={{ color: "#b42318", fontSize: 14, margin: 0 }}>{error}</p>}

        <p className="muted" style={{ fontSize: 12, maxWidth: 300, marginTop: 4 }}>
          First time? Signing in creates your account automatically. Your data stays private to you.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="app-shell" />}>
      <LoginInner />
    </Suspense>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

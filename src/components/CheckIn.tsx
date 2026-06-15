"use client";

import { useRef, useState } from "react";
import { fileToDataUrl, uploadPhoto } from "@/lib/photos";
import type { BodyAnalysis } from "@/lib/types";

type Current = { calories: number; protein_g: number; carbs_g: number; fat_g: number };

// The 7-day check-in. Reads new weight + optional photos, asks Claude for an
// assessment + proposed macros, shows a side-by-side compare. NEVER auto-applies.
export function CheckIn({ onClose, onApplied }: { onClose: () => void; onApplied: () => void }) {
  const [weight, setWeight] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Current | null>(null);
  const [proposed, setProposed] = useState<BodyAnalysis | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const url = await fileToDataUrl(f);
    setPhotos((p) => [...p, url].slice(0, 2));
  }

  async function analyze() {
    if (!weight) {
      setError("Enter your current weight.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const p of photos) await uploadPhoto(p, "progress");
      const res = await fetch("/api/checkin/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weight_kg: Number(weight), photos }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Check-in failed.");
      setCurrent(json.current as Current);
      setProposed(json.proposed as BodyAnalysis);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!proposed) return;
    setBusy(true);
    try {
      const res = await fetch("/api/checkin/apply", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          calories: proposed.calories,
          protein_g: proposed.protein_g,
          carbs_g: proposed.carbs_g,
          fat_g: proposed.fat_g,
          goal_type: proposed.goal_type,
          body_fat_estimate: proposed.body_fat_estimate,
          body_type_read: proposed.body_type_read,
          notes: proposed.rationale,
        }),
      });
      if (!res.ok) throw new Error("Could not apply.");
      onApplied();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        {!proposed ? (
          <>
            <h3>Weekly check-in</h3>
            <label className="label">Current weight (kg)</label>
            <input className="field" type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="72" autoFocus />
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={addPhoto} />
            <button className="btn btn-ghost" style={{ marginTop: 12 }} onClick={() => fileRef.current?.click()}>
              {photos.length ? `✓ ${photos.length} photo(s)` : "📷 Add a progress photo (optional)"}
            </button>
            {error && <p style={{ color: "#b42318", fontSize: 14 }}>{error}</p>}
            <div className="row">
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary" disabled={busy} onClick={analyze}>
                {busy ? <span className="spinner" /> : "Analyze"}
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>Your check-in</h3>
            {proposed.assessment && <p className="sub" style={{ marginBottom: 12 }}>{proposed.assessment}</p>}
            <div className="row" style={{ marginTop: 0 }}>
              <CompareCard title="Current" g={current!} highlight={false} />
              <CompareCard title="Suggested" g={proposed} highlight />
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>{proposed.rationale}</p>
            <p className="muted" style={{ fontSize: 12 }}>Body fat est. {proposed.body_fat_estimate} · {proposed.confidence_note}</p>
            {error && <p style={{ color: "#b42318", fontSize: 14 }}>{error}</p>}
            <div className="row">
              <button className="btn btn-ghost" disabled={busy} onClick={onClose}>Keep current</button>
              <button className="btn btn-primary" disabled={busy} onClick={accept}>
                {busy ? <span className="spinner" /> : "Switch to new"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function CompareCard({ title, g, highlight }: { title: string; g: { calories: number; protein_g: number; carbs_g: number; fat_g: number }; highlight: boolean }) {
  return (
    <div
      className="card"
      style={{ flex: 1, animation: "none", ...(highlight ? { background: "var(--accent-soft)", borderColor: "var(--accent)" } : {}) }}
    >
      <div className="meal" style={{ fontSize: 13 }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{Math.round(g.calories).toLocaleString()}</div>
      <div className="muted" style={{ fontSize: 11 }}>cal</div>
      <div className="macros-mini" style={{ flexDirection: "column", gap: 2, marginTop: 6 }}>
        <span>P {Math.round(g.protein_g)}g</span>
        <span>C {Math.round(g.carbs_g)}g</span>
        <span>F {Math.round(g.fat_g)}g</span>
      </div>
    </div>
  );
}

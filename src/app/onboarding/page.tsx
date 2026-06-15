"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fileToDataUrl, uploadPhoto } from "@/lib/photos";
import { LoadingJoke } from "@/components/LoadingJoke";
import type { BodyAnalysis } from "@/lib/types";

type Unit = "metric" | "imperial";
const GOALS = [
  { v: "recomp", label: "Body recomposition" },
  { v: "bulk", label: "Lean bulk" },
  { v: "cut", label: "Cut" },
  { v: "maintain", label: "Maintain" },
  { v: "auto", label: "Just want a great body — you decide" },
];
const ACTIVITY = [
  { v: "sedentary", label: "Sedentary", hint: "desk job, little movement" },
  { v: "light", label: "Light", hint: "light walking, 1-2 workouts/wk" },
  { v: "moderate", label: "Moderate", hint: "active + 3-4 workouts/wk" },
  { v: "very", label: "Very active", hint: "on feet all day or 5+ workouts/wk" },
];
const MAX_PHOTOS = 4;
const MAX_MEDICAL_DOCS = 2;
const MAX_MEDICAL_DOC_BYTES = 2 * 1024 * 1024;
const MAX_MEDICAL_DOC_TOTAL_BYTES = 3 * 1024 * 1024;
const MEDICAL_DOC_ACCEPT =
  ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

type MedicalDocUpload = {
  name: string;
  mime_type: string;
  data_url: string;
  size: number;
};

export default function Onboarding() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BodyAnalysis | null>(null);

  // form state
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [age, setAge] = useState("");
  const [unit, setUnit] = useState<Unit>("metric");
  const [heightCm, setHeightCm] = useState("");
  const [heightFt, setHeightFt] = useState("");
  const [heightIn, setHeightIn] = useState("");
  const [weight, setWeight] = useState(""); // value in chosen unit
  const [sex, setSex] = useState<"male" | "female" | "unspecified">("unspecified");
  const [buildNote, setBuildNote] = useState("");
  const [goalType, setGoalType] = useState("auto");
  const [goalNote, setGoalNote] = useState("");
  const [medicalDocs, setMedicalDocs] = useState<MedicalDocUpload[]>([]);
  const [activity, setActivity] = useState("moderate");
  const [steps_, setSteps_] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);

  const steps = ["You", "Body", "Activity", "Goal", "Medical", "Photos"];

  function heightToCm(): number | null {
    if (unit === "metric") return heightCm ? Number(heightCm) : null;
    const ft = Number(heightFt) || 0;
    const inch = Number(heightIn) || 0;
    if (!ft && !inch) return null;
    return Math.round((ft * 12 + inch) * 2.54);
  }
  function weightToKg(): number | null {
    if (!weight) return null;
    return unit === "metric" ? Number(weight) : Math.round(Number(weight) * 0.453592 * 10) / 10;
  }

  async function addPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const url = await fileToDataUrl(f);
      setPhotos((p) => [...p, url].slice(0, MAX_PHOTOS));
    } catch {
      setError("Could not read that photo.");
    }
  }

  async function addMedicalDocs(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;

    const slots = MAX_MEDICAL_DOCS - medicalDocs.length;
    if (slots <= 0) {
      setError(`Upload up to ${MAX_MEDICAL_DOCS} medical documents.`);
      return;
    }

    try {
      const nextDocs: MedicalDocUpload[] = [];
      let totalBytes = medicalDocs.reduce((sum, doc) => sum + doc.size, 0);
      for (const file of files.slice(0, slots)) {
        if (!isSupportedMedicalDoc(file)) {
          throw new Error("Upload PDF, DOCX, or TXT medical documents.");
        }
        if (file.size > MAX_MEDICAL_DOC_BYTES) {
          throw new Error(`${file.name} is too large. Use files under 2 MB.`);
        }
        totalBytes += file.size;
        if (totalBytes > MAX_MEDICAL_DOC_TOTAL_BYTES) {
          throw new Error("Keep medical uploads under 3 MB total.");
        }
        nextDocs.push({
          name: file.name,
          mime_type: file.type || inferMedicalMime(file.name),
          data_url: await fileToDataUrlRaw(file),
          size: file.size,
        });
      }
      setMedicalDocs((docs) => [...docs, ...nextDocs]);
      setError(files.length > slots ? `Added ${slots}; upload up to ${MAX_MEDICAL_DOCS} total.` : null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function submit() {
    const weight_kg = weightToKg();
    if (!weight_kg) {
      setError("Weight is required to compute your targets.");
      setStep(1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Persist photos to private storage (best-effort) before analysis.
      for (const p of photos) await uploadPhoto(p, "progress");

      const res = await fetch("/api/onboarding/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          name: `${firstName.trim()} ${lastName.trim()}`.trim() || null,
          age: age ? Number(age) : null,
          height_cm: heightToCm(),
          weight_kg,
          sex,
          build_note: buildNote || null,
          activity_level: activity,
          daily_steps: steps_ ? Number(steps_) : null,
          unit_pref: unit,
          goal_type: goalType,
          goal_note: goalNote || null,
          medical_docs: medicalDocs.map(({ name, mime_type, data_url }) => ({ name, mime_type, data_url })),
          photos,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Analysis failed.");
      setResult(json.analysis as BodyAnalysis);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ---- editable summary screen ----
  if (result) {
    return (
      <EditableSummary
        firstName={firstName}
        analysis={result}
        activity={activity}
        onSaved={() => {
          router.replace("/");
          router.refresh();
        }}
      />
    );
  }

  // ---- loading screen ----
  if (busy) {
    return (
      <div className="app-shell">
        <LoadingJoke label="Reading your build and computing macros…" />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="content" style={{ paddingTop: 28 }}>
        <Dots count={steps.length} active={step} />
        <h2 style={{ marginTop: 8 }}>
          {["A bit about you", "Your body", "How active are you?", "Your goal", "Medical context", "Optional photos"][step]}
        </h2>

        {step === 0 && (
          <>
            <label className="label">First name</label>
            <input className="field" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Bhargav" autoFocus />
            <label className="label">Last name</label>
            <input className="field" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Petla" />
            <label className="label">Age</label>
            <input className="field" type="number" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} placeholder="28" />
          </>
        )}

        {step === 1 && (
          <>
            <div className="pill-group" style={{ marginBottom: 8 }}>
              <button className={`pill ${unit === "metric" ? "on" : ""}`} onClick={() => setUnit("metric")}>Metric</button>
              <button className={`pill ${unit === "imperial" ? "on" : ""}`} onClick={() => setUnit("imperial")}>Imperial</button>
            </div>
            <label className="label">Height</label>
            {unit === "metric" ? (
              <input className="field" type="number" inputMode="numeric" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="cm" />
            ) : (
              <div className="row" style={{ marginTop: 0 }}>
                <input className="field" type="number" value={heightFt} onChange={(e) => setHeightFt(e.target.value)} placeholder="ft" />
                <input className="field" type="number" value={heightIn} onChange={(e) => setHeightIn(e.target.value)} placeholder="in" />
              </div>
            )}
            <label className="label">Current weight ({unit === "metric" ? "kg" : "lb"})</label>
            <input className="field" type="number" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder={unit === "metric" ? "72" : "158"} />
            <label className="label">Sex / build (for macro math)</label>
            <div className="pill-group">
              {(["male", "female", "unspecified"] as const).map((s) => (
                <button key={s} className={`pill ${sex === s ? "on" : ""}`} onClick={() => setSex(s)}>
                  {s === "unspecified" ? "prefer not to say" : s}
                </button>
              ))}
            </div>
            <label className="label">Anything about your build worth knowing? (optional)</label>
            <input className="field" value={buildNote} onChange={(e) => setBuildNote(e.target.value)} placeholder="e.g. South Indian frame, ectomorph, broad shoulders" />
          </>
        )}

        {step === 2 && (
          <>
            <p className="muted" style={{ fontSize: 14 }}>
              This sets your calorie needs — more active means more food.
            </p>
            <div className="pill-group" style={{ flexDirection: "column", alignItems: "stretch" }}>
              {ACTIVITY.map((a) => (
                <button
                  key={a.v}
                  className={`pill ${activity === a.v ? "on" : ""}`}
                  style={{ textAlign: "left" }}
                  onClick={() => setActivity(a.v)}
                >
                  {a.label} <span style={{ opacity: 0.7, fontWeight: 400 }}>— {a.hint}</span>
                </button>
              ))}
            </div>
            <label className="label">Typical daily steps (optional)</label>
            <input
              className="field"
              type="number"
              inputMode="numeric"
              value={steps_}
              onChange={(e) => setSteps_(e.target.value)}
              placeholder="e.g. 8000"
            />
          </>
        )}

        {step === 3 && (
          <>
            <div className="pill-group" style={{ flexDirection: "column", alignItems: "stretch" }}>
              {GOALS.map((g) => (
                <button key={g.v} className={`pill ${goalType === g.v ? "on" : ""}`} style={{ textAlign: "left" }} onClick={() => setGoalType(g.v)}>
                  {g.label}
                </button>
              ))}
            </div>
            <label className="label">Anything to add? (optional)</label>
            <input className="field" value={goalNote} onChange={(e) => setGoalNote(e.target.value)} placeholder="want visible abs but keep strength" />
          </>
        )}

        {step === 4 && (
          <>
            <p className="muted" style={{ fontSize: 14 }}>
              Optional: upload lab reports, doctor notes, allergies, injury notes, or condition summaries as PDF, DOCX, or TXT.
              These are saved privately and used as safety context for Sonnet.
            </p>
            <div style={{ display: "grid", gap: 8 }}>
              {medicalDocs.map((doc, i) => (
                <div
                  key={`${doc.name}-${i}`}
                  className="card"
                  style={{
                    borderRadius: 12,
                    padding: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {doc.name}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>{formatBytes(doc.size)}</div>
                  </div>
                  <button
                    className="icon-btn"
                    onClick={() => setMedicalDocs((docs) => docs.filter((_, j) => j !== i))}
                    aria-label="Remove medical document"
                    style={{ flex: "0 0 auto" }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {medicalDocs.length < MAX_MEDICAL_DOCS && (
              <label className="btn btn-ghost" style={{ display: "block", textAlign: "center", marginTop: 12 }}>
                Upload medical document ({medicalDocs.length}/{MAX_MEDICAL_DOCS})
                <input type="file" accept={MEDICAL_DOC_ACCEPT} multiple hidden onChange={addMedicalDocs} />
              </label>
            )}
            <p className="muted" style={{ fontSize: 12 }}>
              You can add or delete these later in Settings. It is still fitness guidance, not medical advice.
            </p>
          </>
        )}

        {step === 5 && (
          <>
            <p className="muted" style={{ fontSize: 14 }}>
              Add up to {MAX_PHOTOS} photos from different angles (front, side, back) for a better body-fat read.
              <b> Fully optional</b> and private — stored only in your own database, only you see it.
            </p>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {photos.map((p, i) => (
                <div key={i} style={{ position: "relative" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p} alt="" style={{ width: 80, height: 106, objectFit: "cover", borderRadius: 12 }} />
                  <button
                    onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}
                    style={{
                      position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%",
                      border: "none", background: "var(--ink)", color: "#fff", fontSize: 13, lineHeight: 1,
                    }}
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            {photos.length < MAX_PHOTOS && (
              <label className="btn btn-ghost" style={{ display: "block", textAlign: "center", marginTop: 12 }}>
                📷 Add photo ({photos.length}/{MAX_PHOTOS})
                <input type="file" accept="image/*" hidden onChange={addPhoto} />
              </label>
            )}
          </>
        )}

        {error && <p style={{ color: "#b42318", fontSize: 14 }}>{error}</p>}

        <div className="row">
          {step > 0 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
          {step < steps.length - 1 ? (
            <button
              className="btn btn-primary"
              disabled={step === 0 && !firstName.trim()}
              onClick={() => setStep(step + 1)}
            >
              Continue
            </button>
          ) : (
            <button className="btn btn-primary" onClick={submit}>Build my plan</button>
          )}
        </div>
      </div>
    </div>
  );
}

function fileToDataUrlRaw(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Could not read that file."));
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function isSupportedMedicalDoc(file: File): boolean {
  const mime = file.type || inferMedicalMime(file.name);
  return (
    mime === "application/pdf" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "text/plain"
  );
}

function inferMedicalMime(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".txt")) return "text/plain";
  return "";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Dots({ count, active }: { count: number; active: number }) {
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
      {Array.from({ length: count }).map((_, i) => (
        <span
          key={i}
          style={{
            width: i === active ? 22 : 7,
            height: 7,
            borderRadius: 999,
            background: i === active ? "var(--accent)" : "var(--line)",
            transition: "all 0.25s var(--ease)",
          }}
        />
      ))}
    </div>
  );
}

// Lets the user review and tweak the AI's proposed targets before saving them.
function EditableSummary({
  firstName,
  analysis,
  activity,
  onSaved,
}: {
  firstName: string;
  analysis: BodyAnalysis;
  activity: string;
  onSaved: () => void;
}) {
  const [calories, setCalories] = useState(String(Math.round(analysis.calories)));
  const [protein, setProtein] = useState(String(Math.round(analysis.protein_g)));
  const [carbs, setCarbs] = useState(String(Math.round(analysis.carbs_g)));
  const [fat, setFat] = useState(String(Math.round(analysis.fat_g)));
  const [bodyFat, setBodyFat] = useState(analysis.body_fat_estimate);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/onboarding/save-goal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          calories: Number(calories),
          protein_g: Number(protein),
          carbs_g: Number(carbs),
          fat_g: Number(fat),
          goal_type: analysis.goal_type,
          activity_level: analysis.activity_level ?? activity,
          body_fat_estimate: bodyFat,
          body_type_read: analysis.body_type_read,
          notes: analysis.rationale,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not save.");
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="content" style={{ paddingTop: 36 }}>
        <h2 style={{ textAlign: "center" }}>
          {firstName ? `Here's your plan, ${firstName}` : "Here's your plan"}
        </h2>
        <p className="muted" style={{ textAlign: "center", fontSize: 13, marginTop: -4 }}>
          The AI suggested these. Tweak anything before you start.
        </p>

        <div className="card">
          <label className="label" style={{ marginTop: 0 }}>Calories / day</label>
          <input className="field" type="number" inputMode="numeric" value={calories} onChange={(e) => setCalories(e.target.value)} />
          <div className="row" style={{ marginTop: 12 }}>
            <div style={{ flex: 1 }}>
              <label className="label" style={{ marginTop: 0 }}><i className="dot" style={{ background: "var(--protein)" }} />Protein g</label>
              <input className="field" type="number" value={protein} onChange={(e) => setProtein(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label" style={{ marginTop: 0 }}><i className="dot" style={{ background: "var(--carbs)" }} />Carbs g</label>
              <input className="field" type="number" value={carbs} onChange={(e) => setCarbs(e.target.value)} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="label" style={{ marginTop: 0 }}><i className="dot" style={{ background: "var(--fat)" }} />Fat g</label>
              <input className="field" type="number" value={fat} onChange={(e) => setFat(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="card">
          <div className="meal">Body read</div>
          <label className="label" style={{ marginTop: 6 }}>Estimated body fat</label>
          <input className="field" value={bodyFat} onChange={(e) => setBodyFat(e.target.value)} placeholder="e.g. 14-17%" />
          <p className="sub" style={{ marginTop: 8 }}>{analysis.body_type_read}</p>
          <p className="muted" style={{ fontSize: 12 }}>{analysis.confidence_note}</p>
        </div>

        {analysis.rationale && <p className="muted" style={{ fontSize: 13 }}>{analysis.rationale}</p>}
        {err && <p style={{ color: "#b42318", fontSize: 14 }}>{err}</p>}

        <button className="btn btn-primary" style={{ marginTop: 8 }} disabled={busy} onClick={save}>
          {busy ? <span className="spinner" /> : "Save & start logging"}
        </button>
      </div>
    </div>
  );
}

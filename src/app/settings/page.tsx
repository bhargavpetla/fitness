"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  fetchProfile,
  fetchActiveGoal,
  fetchExerciseConfig,
  saveExerciseConfig,
  clearEndGoal,
} from "@/lib/db";
import { exportEverything } from "@/lib/export";
import { CheckIn } from "@/components/CheckIn";
import { CalendarView } from "@/components/CalendarView";
import type { Profile, Goal, ExerciseConfig } from "@/lib/types";

const MEDICAL_DOC_ACCEPT =
  ".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";
const MAX_STORED_MEDICAL_DOCS = 4;
const MAX_MEDICAL_DOC_BYTES = 2 * 1024 * 1024;
const MAX_MEDICAL_DOC_TOTAL_BYTES = 3 * 1024 * 1024;

type SettingsMedicalDocument = {
  id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export default function Settings() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [goal, setGoal] = useState<Goal | null>(null);
  const [cfg, setCfg] = useState<ExerciseConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [checkin, setCheckin] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [medicalDocs, setMedicalDocs] = useState<SettingsMedicalDocument[]>([]);
  const [uploadingMedicalDoc, setUploadingMedicalDoc] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  // editable fields
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [buildNote, setBuildNote] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [goalType, setGoalType] = useState("auto");
  const [weeklyTarget, setWeeklyTarget] = useState("4");
  const [split, setSplit] = useState("");
  const [cardio, setCardio] = useState("");

  // manual daily-target editing
  const [editCalories, setEditCalories] = useState("");
  const [editProtein, setEditProtein] = useState("");
  const [editCarbs, setEditCarbs] = useState("");
  const [editFat, setEditFat] = useState("");
  const [savingTarget, setSavingTarget] = useState(false);
  const [latestWeight, setLatestWeight] = useState<number | null>(null);

  // optional end goal (AI sets the timeframe)
  const [endGoalText, setEndGoalText] = useState("");
  const [savingEndGoal, setSavingEndGoal] = useState(false);
  const [endGoalEta, setEndGoalEta] = useState<{ rationale: string; estimated_days: number; target_date: string } | null>(null);

  useEffect(() => {
    (async () => {
      const [p, g, c, docs] = await Promise.all([
        fetchProfile(),
        fetchActiveGoal(),
        fetchExerciseConfig(),
        fetchMedicalDocs(),
      ]);
      setProfile(p);
      setGoal(g);
      setCfg(c);
      setMedicalDocs(docs);

      // Latest weigh-in drives the protein-per-kg hint and prefills the recompute weight.
      const sb = createClient();
      const { data: u } = await sb.auth.getUser();
      if (u.user) {
        const { data: w } = await sb
          .from("weigh_ins")
          .select("weight_kg")
          .eq("user_id", u.user.id)
          .order("date", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (w?.weight_kg != null) {
          setLatestWeight(Number(w.weight_kg));
          setWeightKg(String(w.weight_kg));
        }
      }
      if (p) {
        setName(p.name ?? "");
        setAge(p.age?.toString() ?? "");
        setHeightCm(p.height_cm?.toString() ?? "");
        setBuildNote(p.build_note ?? "");
        setEndGoalText(p.end_goal ?? "");
        if (p.end_goal && p.end_goal_target_date) {
          const days = Math.max(0, Math.round((new Date(p.end_goal_target_date).getTime() - Date.now()) / 86_400_000));
          setEndGoalEta({ rationale: "", estimated_days: days, target_date: p.end_goal_target_date });
        }
      }
      if (g) {
        setGoalType(g.goal_type);
        setEditCalories(Math.round(Number(g.calories)).toString());
        setEditProtein(Math.round(Number(g.protein_g)).toString());
        setEditCarbs(Math.round(Number(g.carbs_g)).toString());
        setEditFat(Math.round(Number(g.fat_g)).toString());
      }
      if (c) {
        setWeeklyTarget(c.weekly_target_sessions?.toString() ?? "4");
        setSplit(c.split_pattern ?? "");
        setCardio(c.cardio_target_per_week?.toString() ?? "");
      }
    })();
  }, []);

  async function fetchMedicalDocs(): Promise<SettingsMedicalDocument[]> {
    try {
      const res = await fetch("/api/medical-documents");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load medical documents.");
      return json.documents ?? [];
    } catch {
      return [];
    }
  }

  async function reloadMedicalDocs() {
    setMedicalDocs(await fetchMedicalDocs());
  }

  async function saveProfile() {
    setBusy(true);
    const sb = createClient();
    const { data: u } = await sb.auth.getUser();
    if (u.user) {
      await sb.from("profiles").update({
        name: name || null,
        age: age ? Number(age) : null,
        height_cm: heightCm ? Number(heightCm) : null,
        build_note: buildNote || null,
      }).eq("user_id", u.user.id);
    }
    await saveExerciseConfig({
      weekly_target_sessions: Number(weeklyTarget) || 4,
      split_pattern: split || null,
      cardio_target_per_week: cardio ? Number(cardio) : null,
    });
    setBusy(false);
    setMsg("Saved.");
    setTimeout(() => setMsg(null), 2000);
  }

  async function refreshGoals() {
    if (!weightKg) {
      setMsg("Enter current weight to recompute.");
      return;
    }
    if (!confirm("Recompute your macro target from current values? Old logs stay unchanged.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/goals/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weight_kg: Number(weightKg), goal_type: goalType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Refresh failed.");
      setGoal(await fetchActiveGoal());
      setMsg("New target active. History untouched.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveManualTarget() {
    setSavingTarget(true);
    setMsg(null);
    try {
      const res = await fetch("/api/goals/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          calories: Number(editCalories),
          protein_g: Number(editProtein),
          carbs_g: Number(editCarbs),
          fat_g: Number(editFat),
          goal_type: goalType === "auto" ? undefined : goalType,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save target.");
      setGoal(await fetchActiveGoal());
      setMsg("Daily target updated. History untouched.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSavingTarget(false);
    }
  }

  async function saveEndGoalText() {
    if (!endGoalText.trim()) {
      setMsg("Describe the goal you want to reach.");
      return;
    }
    setSavingEndGoal(true);
    setMsg(null);
    try {
      const res = await fetch("/api/goals/end-goal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ end_goal: endGoalText.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save goal.");
      setEndGoalEta({ rationale: json.rationale, estimated_days: json.estimated_days, target_date: json.target_date });
      // The AI recomputed macros for this goal — refresh the displayed target and editor.
      const fresh = await fetchActiveGoal();
      setGoal(fresh);
      if (fresh) {
        setEditCalories(Math.round(Number(fresh.calories)).toString());
        setEditProtein(Math.round(Number(fresh.protein_g)).toString());
        setEditCarbs(Math.round(Number(fresh.carbs_g)).toString());
        setEditFat(Math.round(Number(fresh.fat_g)).toString());
      }
      setMsg("Goal saved. Macros recalculated — your countdown is on the home screen.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSavingEndGoal(false);
    }
  }

  async function removeEndGoal() {
    if (!confirm("Remove your end goal and its countdown?")) return;
    setSavingEndGoal(true);
    setMsg(null);
    try {
      await clearEndGoal();
      setEndGoalText("");
      setEndGoalEta(null);
      setMsg("End goal removed.");
    } finally {
      setSavingEndGoal(false);
    }
  }

  async function uploadMedicalDoc(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (!isSupportedMedicalDoc(file)) {
      setMsg("Upload PDF, DOCX, or TXT medical documents.");
      return;
    }
    if (file.size > MAX_MEDICAL_DOC_BYTES) {
      setMsg(`${file.name} is too large. Use files under 2 MB.`);
      return;
    }
    const totalBytes = medicalDocs.reduce((sum, doc) => sum + doc.size_bytes, 0) + file.size;
    if (totalBytes > MAX_MEDICAL_DOC_TOTAL_BYTES) {
      setMsg("Keep medical uploads under 3 MB total.");
      return;
    }

    setUploadingMedicalDoc(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/medical-documents", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed.");
      await reloadMedicalDocs();
      setMsg("Medical document saved.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setUploadingMedicalDoc(false);
    }
  }

  async function deleteMedicalDoc(id: string) {
    if (!confirm("Delete this medical document? Future AI reads will no longer use it.")) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/medical-documents/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Delete failed.");
      await reloadMedicalDocs();
      setMsg("Medical document deleted.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    if (!confirm("Sign out? You'll need an email code to get back in.")) return;
    setSigningOut(true);
    const sb = createClient();
    await sb.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  async function deleteAccount() {
    const typed = prompt(
      "This permanently deletes your profile, goals, logs, photos, medical documents, and login account. Type DELETE to confirm."
    );
    if (typed !== "DELETE") return;

    setDeletingAccount(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/delete", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not delete account.");
      const sb = createClient();
      await sb.auth.signOut();
      router.replace("/login");
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
      setDeletingAccount(false);
    }
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <button className="icon-btn" onClick={() => router.push("/")} aria-label="Back">‹</button>
        <span className="daycount">Settings</span>
        <span style={{ width: 38 }} />
      </div>

      <div className="content" style={{ paddingTop: 8 }}>
        {goal && (
          <div className="card" style={{ background: "var(--accent-soft)", borderColor: "var(--accent)" }}>
            <div className="meal">Current target</div>
            <div className="macros-mini" style={{ fontSize: 14 }}>
              <span>{Math.round(Number(goal.calories)).toLocaleString()} cal</span>
              <span>P {Math.round(Number(goal.protein_g))}g</span>
              <span>C {Math.round(Number(goal.carbs_g))}g</span>
              <span>F {Math.round(Number(goal.fat_g))}g</span>
            </div>
            {goal.body_fat_estimate && <p className="muted" style={{ fontSize: 12 }}>Body fat est. {goal.body_fat_estimate}</p>}
          </div>
        )}

        <Section title="End goal (optional)">
          <p className="muted" style={{ fontSize: 13 }}>
            Describe the body you want to reach — a goal weight for weight loss, a target body-fat % for recomp, anything. The AI recalculates your macros for that goal and picks a healthy, efficient timeframe. A countdown then appears on your home screen and adjusts to how consistently you hit your targets.
          </p>
          <textarea
            className="field"
            rows={2}
            value={endGoalText}
            onChange={(e) => setEndGoalText(e.target.value)}
            placeholder="e.g. lose 4 kg / reach 12-14% body fat with visible abs"
          />
          {endGoalEta && (
            <div className="card" style={{ marginTop: 10, background: "var(--accent-soft)", borderColor: "var(--accent)" }}>
              <div className="meal" style={{ fontSize: 14 }}>
                🎯 Healthy timeframe: ~{endGoalEta.estimated_days} days
              </div>
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
                Target around {new Date(endGoalEta.target_date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}.
                {endGoalEta.rationale ? ` ${endGoalEta.rationale}` : ""}
              </p>
            </div>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            {endGoalEta && (
              <button className="btn btn-ghost" disabled={savingEndGoal} onClick={removeEndGoal}>
                Remove
              </button>
            )}
            <button className="btn btn-primary" disabled={savingEndGoal} onClick={saveEndGoalText}>
              {savingEndGoal ? <span className="spinner" /> : endGoalEta ? "Update goal" : "Set goal & recalc macros"}
            </button>
          </div>
        </Section>

        <Section title="Edit daily target">
          <p className="muted" style={{ fontSize: 13 }}>
            Set your own calories and macros directly. Saved as your new active target — takes effect now, all history stays exactly as logged.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label className="label">Calories</label>
              <input className="field" type="number" inputMode="numeric" value={editCalories} onChange={(e) => setEditCalories(e.target.value)} placeholder="2300" />
            </div>
            <div>
              <label className="label">Protein (g)</label>
              <input className="field" type="number" inputMode="numeric" value={editProtein} onChange={(e) => setEditProtein(e.target.value)} placeholder="120" />
            </div>
            <div>
              <label className="label">Carbs (g)</label>
              <input className="field" type="number" inputMode="numeric" value={editCarbs} onChange={(e) => setEditCarbs(e.target.value)} placeholder="270" />
            </div>
            <div>
              <label className="label">Fat (g)</label>
              <input className="field" type="number" inputMode="numeric" value={editFat} onChange={(e) => setEditFat(e.target.value)} placeholder="60" />
            </div>
          </div>
          <MacroHint
            weightKg={latestWeight}
            calories={Number(editCalories)}
            protein={Number(editProtein)}
            carbs={Number(editCarbs)}
            fat={Number(editFat)}
          />
          <button className="btn btn-primary" style={{ marginTop: 12 }} disabled={savingTarget} onClick={saveManualTarget}>
            {savingTarget ? <span className="spinner" /> : "Save daily target"}
          </button>
        </Section>

        <Section title="Profile">
          <label className="label">Name</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="label">Age</label>
          <input className="field" type="number" value={age} onChange={(e) => setAge(e.target.value)} />
          <label className="label">Height (cm)</label>
          <input className="field" type="number" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
          <label className="label">Build note</label>
          <input className="field" value={buildNote} onChange={(e) => setBuildNote(e.target.value)} />
        </Section>

        <Section title="Exercise config">
          <label className="label">Weekly sessions target</label>
          <input className="field" type="number" value={weeklyTarget} onChange={(e) => setWeeklyTarget(e.target.value)} />
          <label className="label">Split pattern (e.g. PPL,rest)</label>
          <input className="field" value={split} onChange={(e) => setSplit(e.target.value)} placeholder="PPL,rest" />
          <label className="label">Cardio target / week (optional)</label>
          <input className="field" type="number" value={cardio} onChange={(e) => setCardio(e.target.value)} />
        </Section>

        <button className="btn btn-primary" disabled={busy} onClick={saveProfile}>
          {busy ? <span className="spinner" /> : "Save changes"}
        </button>

        <Section title="Refresh goal">
          <p className="muted" style={{ fontSize: 13 }}>
            Recompute your macro target from current values. Takes effect going forward — all history stays exactly as logged.
          </p>
          <label className="label">Goal type</label>
          <select className="field" value={goalType} onChange={(e) => setGoalType(e.target.value)}>
            <option value="recomp">Recomp</option>
            <option value="bulk">Lean bulk</option>
            <option value="cut">Cut</option>
            <option value="maintain">Maintain</option>
            <option value="auto">You decide</option>
          </select>
          <label className="label">Current weight (kg)</label>
          <input className="field" type="number" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="72" />
          <button className="btn btn-ghost" style={{ marginTop: 12 }} disabled={busy} onClick={refreshGoals}>
            {busy ? <span className="spinner" style={{ borderTopColor: "var(--accent)" }} /> : "Recompute target"}
          </button>
        </Section>

        <Section title="Medical context">
          <p className="muted" style={{ fontSize: 13 }}>
            Saved medical PDFs or Word/TXT notes are used as safety context when you recompute goals or run check-ins.
          </p>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {medicalDocs.map((doc) => (
              <div
                key={doc.id}
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
                    {doc.file_name}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {formatBytes(doc.size_bytes)} · {new Date(doc.created_at).toLocaleDateString()}
                  </div>
                </div>
                <button
                  className="icon-btn"
                  style={{ color: "#b42318", flex: "0 0 auto" }}
                  disabled={busy}
                  onClick={() => deleteMedicalDoc(doc.id)}
                  aria-label={`Delete ${doc.file_name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {!medicalDocs.length && (
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              No medical documents saved yet.
            </p>
          )}
          {medicalDocs.length < MAX_STORED_MEDICAL_DOCS && (
            <label className="btn btn-ghost" style={{ display: "block", textAlign: "center", marginTop: 12 }}>
              {uploadingMedicalDoc ? "Uploading…" : "Upload medical document"}
              <input type="file" accept={MEDICAL_DOC_ACCEPT} hidden disabled={uploadingMedicalDoc} onChange={uploadMedicalDoc} />
            </label>
          )}
          <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            PDF, DOCX, or TXT. Up to {MAX_STORED_MEDICAL_DOCS} saved files, 2 MB each, 3 MB total.
          </p>
        </Section>

        <Section title="Weekly check-in">
          <p className="muted" style={{ fontSize: 13 }}>
            Re-read weight (and optional photos) and get a proposed macro adjustment. Nothing changes unless you accept.
          </p>
          <button className="btn btn-ghost" onClick={() => setCheckin(true)}>Start check-in</button>
        </Section>

        <Section title="Nutrition history">
          <p className="muted" style={{ fontSize: 13 }}>
            Per-day calories, macros and AI-estimated vitamins from your food entries.
          </p>
          <button className="btn btn-ghost" onClick={() => setCalendar(true)}>View calendar &amp; vitamins</button>
        </Section>

        <Section title="Data">
          <button className="btn btn-ghost" disabled={exporting} onClick={async () => { setExporting(true); try { await exportEverything(); } finally { setExporting(false); } }}>
            {exporting ? <span className="spinner" style={{ borderTopColor: "var(--accent)" }} /> : "Export everything (.xlsx)"}
          </button>
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            🔒 All data, photos, and medical documents live in your private database. Nothing is shared.
          </p>
        </Section>

        <Section title="Danger zone">
          <p className="muted" style={{ fontSize: 13 }}>
            Permanently delete your profile, goals, food logs, exercise logs, photos, medical documents, and login account.
          </p>
          <button className="btn btn-ghost" style={{ color: "#b42318" }} disabled={deletingAccount} onClick={deleteAccount}>
            {deletingAccount ? <span className="spinner" style={{ borderTopColor: "#b42318" }} /> : "Delete my profile fully"}
          </button>
        </Section>

        <button className="btn btn-ghost" style={{ color: "#b42318", marginTop: 8 }} disabled={signingOut} onClick={signOut}>
          {signingOut ? <span className="spinner" style={{ borderTopColor: "#b42318" }} /> : "Sign out"}
        </button>

        {msg && <p style={{ textAlign: "center", color: "var(--accent)", fontSize: 14, marginTop: 12 }}>{msg}</p>}
      </div>

      {checkin && (
        <CheckIn
          onClose={() => setCheckin(false)}
          onApplied={async () => {
            setCheckin(false);
            setGoal(await fetchActiveGoal());
            setMsg("New target applied.");
          }}
        />
      )}

      {calendar && (
        <CalendarView goal={goal} onClose={() => setCalendar(false)} onPickDate={() => setCalendar(false)} />
      )}
    </div>
  );
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

// Live sanity check under the manual macro editor: shows protein g/kg (flagging
// values above ~2 g/kg as high) and whether the macros add up to the calories
// (protein/carbs 4 kcal/g, fat 9 kcal/g).
function MacroHint({
  weightKg,
  calories,
  protein,
  carbs,
  fat,
}: {
  weightKg: number | null;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}) {
  if (![calories, protein, carbs, fat].every(Number.isFinite)) return null;

  const macroCalories = protein * 4 + carbs * 4 + fat * 9;
  const diff = Math.round(macroCalories - calories);
  const perKg = weightKg && weightKg > 0 ? protein / weightKg : null;
  const proteinHigh = perKg != null && perKg > 2.0;
  const macrosOff = calories > 0 && Math.abs(diff) > Math.max(80, calories * 0.07);

  return (
    <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.5 }}>
      {perKg != null && (
        <p className="muted" style={{ margin: 0, color: proteinHigh ? "#b42318" : undefined }}>
          Protein: {perKg.toFixed(1)} g/kg
          {proteinHigh ? " — that's high; ~1.6–2.0 g/kg is plenty for most." : " (healthy range ~1.6–2.0 g/kg)."}
        </p>
      )}
      {calories > 0 && (
        <p className="muted" style={{ margin: "2px 0 0", color: macrosOff ? "#b42318" : undefined }}>
          Macros ≈ {Math.round(macroCalories).toLocaleString()} kcal
          {macrosOff ? ` (${diff > 0 ? "+" : ""}${diff} vs your calorie number — they don't add up).` : " — adds up to your calorie target. ✓"}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 15, color: "var(--ink-2)", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 4px" }}>
        {title}
      </h3>
      {children}
    </div>
  );
}

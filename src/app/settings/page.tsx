"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  fetchProfile,
  fetchActiveGoal,
  fetchExerciseConfig,
  saveExerciseConfig,
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
      if (p) {
        setName(p.name ?? "");
        setAge(p.age?.toString() ?? "");
        setHeightCm(p.height_cm?.toString() ?? "");
        setBuildNote(p.build_note ?? "");
      }
      if (g) setGoalType(g.goal_type);
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

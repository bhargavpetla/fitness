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
      const [p, g, c] = await Promise.all([fetchProfile(), fetchActiveGoal(), fetchExerciseConfig()]);
      setProfile(p);
      setGoal(g);
      setCfg(c);
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

  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    if (!confirm("Sign out? You'll need an email code to get back in.")) return;
    setSigningOut(true);
    const sb = createClient();
    await sb.auth.signOut();
    router.replace("/login");
    router.refresh();
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
            🔒 All data and photos live in your private database. Nothing is shared.
          </p>
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

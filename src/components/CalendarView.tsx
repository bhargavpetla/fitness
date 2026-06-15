"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { prettyDate, todayStr, addDays } from "@/lib/date";
import type { Goal, Vitamins } from "@/lib/types";

interface DaySummary {
  date: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  entries: number;
  vitamins: Vitamins;
}

type Period = "day" | "week" | "month";

interface Progress {
  summary: string;
  avg: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  goal: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  days_logged: number;
  total_days: number;
  weight_change_kg: number | null;
}

// Insights sheet. Day = per-day list; Week/Month = averages vs goal, adherence,
// and an on-demand AI "where am I / what to adjust" read. Everything tucked behind
// the one calendar button so the main screen stays minimal.
export function CalendarView({
  goal,
  onClose,
  onPickDate,
}: {
  goal: Goal | null;
  onClose: () => void;
  onPickDate: (date: string) => void;
}) {
  const [period, setPeriod] = useState<Period>("day");
  const [days, setDays] = useState<DaySummary[] | null>(null);
  const [progress, setProgress] = useState<Record<"week" | "month", Progress | null>>({ week: null, month: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Day list (loaded once).
  useEffect(() => {
    (async () => {
      const sb = createClient();
      const since = addDays(todayStr(), -30);
      const { data } = await sb
        .from("food_logs")
        .select("date, calories, protein_g, carbs_g, fat_g, vitamins_json")
        .gte("date", since)
        .order("date", { ascending: false });
      const map = new Map<string, DaySummary>();
      for (const f of data ?? []) {
        const cur =
          map.get(f.date) ??
          { date: f.date, calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, entries: 0, vitamins: {} as Vitamins };
        cur.calories += Number(f.calories);
        cur.protein_g += Number(f.protein_g);
        cur.carbs_g += Number(f.carbs_g);
        cur.fat_g += Number(f.fat_g);
        cur.entries += 1;
        for (const k of Object.keys((f.vitamins_json as Vitamins) ?? {})) {
          if (!cur.vitamins[k]) cur.vitamins[k] = (f.vitamins_json as Vitamins)[k];
        }
        map.set(f.date, cur);
      }
      setDays([...map.values()]);
    })();
  }, []);

  // Lazily fetch the AI summary when a period tab is first opened.
  async function ensureProgress(p: "week" | "month") {
    if (progress[p] || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ period: p }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not summarize.");
      setProgress((prev) => ({ ...prev, [p]: json as Progress }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function pick(p: Period) {
    setPeriod(p);
    if (p === "week" || p === "month") ensureProgress(p);
  }

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <h3>Insights</h3>

        {/* period toggle */}
        <div className="tabs" style={{ margin: "0 0 14px" }}>
          {(["day", "week", "month"] as Period[]).map((p) => (
            <button key={p} className={`tab ${period === p ? "active" : ""}`} onClick={() => pick(p)} style={{ textTransform: "capitalize" }}>
              {p}
            </button>
          ))}
        </div>

        {period === "day" && <DayList days={days} goal={goal} onPickDate={onPickDate} />}
        {(period === "week" || period === "month") && (
          <PeriodView data={progress[period]} busy={busy} err={err} />
        )}

        <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>Close</button>
      </div>
    </>
  );
}

function DayList({ days, goal, onPickDate }: { days: DaySummary[] | null; goal: Goal | null; onPickDate: (d: string) => void }) {
  if (!days)
    return (
      <div className="center-screen" style={{ padding: 24 }}>
        <span className="spinner" style={{ borderTopColor: "var(--accent)", borderColor: "var(--line)" }} />
      </div>
    );
  if (days.length === 0) return <p className="muted">No food logged in the last 30 days yet.</p>;
  return (
    <>
      {days.map((d) => {
        const over = goal ? d.calories - Number(goal.calories) : null;
        const vits = Object.keys(d.vitamins);
        return (
          <div key={d.date} className="card" style={{ animation: "none", cursor: "pointer" }} onClick={() => onPickDate(d.date)}>
            <div className="card-top">
              <div className="meal">{prettyDate(d.date)}</div>
              <div className="kcal">{Math.round(d.calories)} kcal</div>
            </div>
            <div className="macros-mini">
              <span><i className="dot" style={{ background: "var(--protein)" }} />P {Math.round(d.protein_g)}g</span>
              <span><i className="dot" style={{ background: "var(--carbs)" }} />C {Math.round(d.carbs_g)}g</span>
              <span><i className="dot" style={{ background: "var(--fat)" }} />F {Math.round(d.fat_g)}g</span>
              <span>{d.entries} {d.entries === 1 ? "entry" : "entries"}</span>
            </div>
            {goal && over != null && (
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0", color: over > 0 ? "var(--carbs)" : "var(--accent)" }}>
                {over > 0 ? `+${Math.round(over)}` : Math.round(over)} vs goal
              </p>
            )}
            {vits.length > 0 && (
              <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
                Vitamins: {vits.slice(0, 6).join(", ")}{vits.length > 6 ? "…" : ""}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}

function PeriodView({ data, busy, err }: { data: Progress | null; busy: boolean; err: string | null }) {
  if (busy && !data)
    return (
      <div className="center-screen" style={{ padding: 24 }}>
        <span className="spinner" style={{ borderTopColor: "var(--accent)", borderColor: "var(--line)" }} />
        <p className="muted" style={{ fontSize: 13 }}>Reading your trend…</p>
      </div>
    );
  if (err) return <p style={{ color: "#b42318", fontSize: 14 }}>{err}</p>;
  if (!data) return null;

  const rows: Array<[string, number, number, string]> = [
    ["Calories", data.avg.calories, data.goal.calories, ""],
    ["Protein", data.avg.protein_g, data.goal.protein_g, "var(--protein)"],
    ["Carbs", data.avg.carbs_g, data.goal.carbs_g, "var(--carbs)"],
    ["Fat", data.avg.fat_g, data.goal.fat_g, "var(--fat)"],
  ];

  return (
    <>
      <div className="card" style={{ animation: "none" }}>
        <div className="meal">Daily average vs goal</div>
        {rows.map(([label, avg, target, color]) => {
          const pct = target > 0 ? Math.min(1, avg / target) : 0;
          return (
            <div key={label} style={{ marginTop: 10 }}>
              <div className="macros-mini" style={{ justifyContent: "space-between", marginTop: 0 }}>
                <span style={{ color: "var(--ink)" }}>{label}</span>
                <span>{Math.round(avg)} / {Math.round(target)}</span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: "var(--line)", marginTop: 4 }}>
                <div style={{ width: `${pct * 100}%`, height: "100%", borderRadius: 999, background: color || "var(--ink)", transition: "width .4s var(--ease)" }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ animation: "none" }}>
        <div className="macros-mini" style={{ justifyContent: "space-between", marginTop: 0 }}>
          <span>Days logged</span>
          <span>{data.days_logged} / {data.total_days}</span>
        </div>
        {data.weight_change_kg != null && (
          <div className="macros-mini" style={{ justifyContent: "space-between" }}>
            <span>Weight change</span>
            <span style={{ color: data.weight_change_kg > 0 ? "var(--carbs)" : "var(--accent)" }}>
              {data.weight_change_kg > 0 ? "+" : ""}{data.weight_change_kg.toFixed(1)} kg
            </span>
          </div>
        )}
      </div>

      <div className="card" style={{ animation: "none", background: "var(--accent-soft)", borderColor: "var(--accent)", whiteSpace: "pre-wrap" }}>
        <div className="meal">Where you are &amp; what to adjust</div>
        <p className="sub" style={{ marginTop: 6, color: "var(--ink)" }}>{data.summary}</p>
      </div>
    </>
  );
}

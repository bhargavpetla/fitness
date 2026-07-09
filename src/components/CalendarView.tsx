"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Icon } from "@/components/Icon";
import { todayStr } from "@/lib/date";

// Google-Photos-style calendar: a full-screen, scrollable run of month grids
// (oldest at top, opens at the current month). Days you logged glow with a
// soft gradient — food in green, a violet dot when you also trained. Tapping
// a day jumps straight to that day's logs on the home screen. No analysis
// here; that lives in /analytics.

export function CalendarView({
  startDate,
  onClose,
  onPickDate,
}: {
  startDate: string | null; // profile start date — the calendar begins here
  onClose: () => void;
  onPickDate: (date: string) => void;
}) {
  const [foodDays, setFoodDays] = useState<Set<string>>(new Set());
  const [trainDays, setTrainDays] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const today = todayStr();
  // Show from the profile's start (capped at 12 months back) through today.
  const from = useMemo(() => {
    const cap = new Date();
    cap.setMonth(cap.getMonth() - 12);
    const capStr = cap.toISOString().slice(0, 10);
    return startDate && startDate > capStr ? startDate : capStr;
  }, [startDate]);

  useEffect(() => {
    (async () => {
      const sb = createClient();
      const [{ data: foods }, { data: exs }] = await Promise.all([
        sb.from("food_logs").select("date").gte("date", from),
        sb.from("exercise_logs").select("date, type").gte("date", from),
      ]);
      setFoodDays(new Set((foods ?? []).map((r) => r.date as string)));
      setTrainDays(new Set((exs ?? []).filter((r) => r.type !== "rest").map((r) => r.date as string)));
      setLoading(false);
    })();
  }, [from]);

  // Open at the bottom — the current month — like a photo timeline.
  useEffect(() => {
    if (!loading && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [loading]);

  const months = useMemo(() => buildMonths(from, today), [from, today]);

  return (
    <div className="cal" role="dialog" aria-modal="true">
      <div className="cal-head">
        <span className="picker-title" style={{ textAlign: "left" }}>Calendar</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="cal-body" ref={bodyRef}>
        {loading ? (
          <div className="center-screen"><span className="spinner" style={{ borderTopColor: "var(--accent)" }} /></div>
        ) : (
          months.map((m) => (
            <div key={m.key} className="cal-month">
              <div className="cal-month-name">{m.label}</div>
              <div className="cal-grid cal-weekdays">
                {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                  <span key={i}>{d}</span>
                ))}
              </div>
              <div className="cal-grid">
                {Array.from({ length: m.lead }, (_, i) => (
                  <span key={`b${i}`} />
                ))}
                {m.days.map((date) => {
                  const dayN = Number(date.slice(8));
                  const logged = foodDays.has(date);
                  const trained = trainDays.has(date);
                  const future = date > today;
                  return (
                    <button
                      key={date}
                      className={`cal-day ${logged || trained ? "logged" : ""} ${date === today ? "today" : ""} ${future ? "future" : ""}`}
                      disabled={future}
                      onClick={() => onPickDate(date)}
                      aria-label={date}
                    >
                      <span>{dayN}</span>
                      {trained && <i className="cal-train-dot" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="cal-foot">
        <span><i className="cal-key logged" /> logged</span>
        <span><i className="cal-key train" /> trained</span>
        <button className="cal-today-btn" onClick={() => onPickDate(today)}>
          <Icon name="calendar-outline" size={14} /> Today
        </button>
      </div>
    </div>
  );
}

interface Month {
  key: string;
  label: string;
  lead: number; // blank cells before day 1 (Monday-first week)
  days: string[];
}

function buildMonths(fromStr: string, toStr: string): Month[] {
  const out: Month[] = [];
  const from = new Date(fromStr + "T00:00:00");
  const to = new Date(toStr + "T00:00:00");
  const cur = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cur <= to) {
    const y = cur.getFullYear();
    const m = cur.getMonth();
    const first = new Date(y, m, 1);
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const days: string[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      days.push(`${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    out.push({
      key: `${y}-${m}`,
      label: first.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      lead: (first.getDay() + 6) % 7, // Monday-first
      days,
    });
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

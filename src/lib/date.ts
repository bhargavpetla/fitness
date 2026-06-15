// Local-date helpers — everything keys on the user's local calendar day (YYYY-MM-DD),
// not UTC, so "today" matches what the phone shows.

export function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

export function prettyDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const today = todayStr();
  if (dateStr === today) return "Today";
  if (dateStr === addDays(today, -1)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

// Days since start (1-indexed) -> the "Day N" counter.
export function dayNumber(startDate: string, on = todayStr()): number {
  const a = new Date(startDate + "T00:00:00").getTime();
  const b = new Date(on + "T00:00:00").getTime();
  return Math.max(1, Math.floor((b - a) / 86400000) + 1);
}

// Monday-anchored week window for the current week (used by the exercise counter).
export function weekStart(on = todayStr()): string {
  const d = new Date(on + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  return addDays(on, -dow);
}

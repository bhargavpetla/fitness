"use client";

// A calm, readable macro breakdown: calories headline + protein / carbs / fat
// rows, each with its fixed hue and a bar showing that macro's share of the
// entry's energy (protein & carbs 4 kcal/g, fat 9 kcal/g). Used inside the
// food and meal detail popups. Color is information here — the hues match the
// rest of the app (see globals.css macro variables).

export function MacroTable({
  calories,
  protein_g,
  carbs_g,
  fat_g,
}: {
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}) {
  const pCal = protein_g * 4;
  const cCal = carbs_g * 4;
  const fCal = fat_g * 9;
  const denom = pCal + cCal + fCal || 1;
  const rows = [
    { label: "Protein", grams: protein_g, pct: (pCal / denom) * 100, color: "var(--protein)" },
    { label: "Carbs", grams: carbs_g, pct: (cCal / denom) * 100, color: "var(--carbs)" },
    { label: "Fat", grams: fat_g, pct: (fCal / denom) * 100, color: "var(--fat)" },
  ];

  return (
    <div className="macro-table">
      <div className="macro-table-cal">
        <span className="macro-table-cal-num">{Math.round(calories)}</span>
        <span className="macro-table-cal-unit">kcal</span>
      </div>
      <div className="macro-table-rows">
        {rows.map((r) => (
          <div key={r.label} className="macro-table-row">
            <span className="macro-table-dot" style={{ background: r.color }} />
            <span className="macro-table-label">{r.label}</span>
            <span className="macro-table-track">
              <span className="macro-table-fill" style={{ width: `${Math.round(r.pct)}%`, background: r.color }} />
            </span>
            <span className="macro-table-grams">{Math.round(r.grams)}<i>g</i></span>
          </div>
        ))}
      </div>
    </div>
  );
}

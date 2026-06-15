"use client";

import { useEffect, useState } from "react";
import { signedUrl } from "@/lib/photos";
import type { FoodLog } from "@/lib/types";

// A food entry that expands on tap to show per-item breakdown, the photo, the
// AI-estimated vitamins, and a delete button.
export function EntryCard({ food, onDelete }: { food: FoodLog; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);

  // Resolve the private photo to a signed URL only when expanded.
  useEffect(() => {
    let active = true;
    if (open && food.photo_url && !photo) {
      signedUrl(food.photo_url).then((u) => {
        if (active) setPhoto(u);
      });
    }
    return () => {
      active = false;
    };
  }, [open, food.photo_url, photo]);

  const items = food.items_json ?? [];
  const vitamins = food.vitamins_json ?? {};
  const vitaminKeys = Object.keys(vitamins);

  return (
    <div className="card">
      <div className="card-top" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer" }}>
        <div>
          <div className="meal">{food.meal_label ?? "meal"}</div>
          <div className="sub">{food.raw_input}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="kcal">{Math.round(Number(food.calories))} kcal</div>
          <div className="muted" style={{ fontSize: 11 }}>{open ? "tap to close" : "tap for details"}</div>
        </div>
      </div>

      <div className="macros-mini">
        <span><i className="dot" style={{ background: "var(--protein)" }} />P {Math.round(Number(food.protein_g))}g</span>
        <span><i className="dot" style={{ background: "var(--carbs)" }} />C {Math.round(Number(food.carbs_g))}g</span>
        <span><i className="dot" style={{ background: "var(--fat)" }} />F {Math.round(Number(food.fat_g))}g</span>
      </div>

      {open && (
        <div style={{ marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="meal" style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 12, marginBottom: 12 }} />
          )}

          {items.length > 0 && (
            <>
              <div className="label" style={{ marginTop: 0 }}>Items</div>
              {items.map((it, i) => (
                <div key={i} className="macros-mini" style={{ justifyContent: "space-between" }}>
                  <span style={{ color: "var(--ink)" }}>
                    {it.name}{it.grams != null ? ` · ${it.grams}g` : ""}
                  </span>
                  <span>{Math.round(it.calories)} kcal · P{it.protein_g} C{it.carbs_g} F{it.fat_g}</span>
                </div>
              ))}
            </>
          )}

          {vitaminKeys.length > 0 && (
            <>
              <div className="label">Vitamins &amp; minerals (est.)</div>
              <div className="pill-group">
                {vitaminKeys.map((k) => (
                  <span key={k} className="pill" style={{ fontWeight: 500 }}>{k}: {vitamins[k]}</span>
                ))}
              </div>
            </>
          )}

          <button
            className="btn btn-ghost"
            style={{ color: "#b42318", marginTop: 14 }}
            onClick={() => {
              if (confirm("Delete this entry?")) onDelete();
            }}
          >
            Delete entry
          </button>
        </div>
      )}
    </div>
  );
}

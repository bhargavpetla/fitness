"use client";

import { useEffect, useState } from "react";
import { signedUrl } from "@/lib/photos";
import { DetailSheet } from "@/components/DetailSheet";
import { MacroTable } from "@/components/MacroTable";
import type { FoodLog } from "@/lib/types";

// A food entry. The card is a calm summary; tapping it opens a big frosted-glass
// popup with the photo, a readable macro table, the per-item breakdown, the
// AI-estimated vitamins, and delete.
export function EntryCard({ food, onDelete }: { food: FoodLog; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);

  // Resolve the private photo to a signed URL only when the popup opens.
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
    <>
      <button className="card entry-card" onClick={() => setOpen(true)}>
        <div className="card-top">
          <div>
            <div className="meal">{food.meal_label ?? "meal"}</div>
            <div className="sub">{food.raw_input}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="kcal">{Math.round(Number(food.calories))} kcal</div>
            <div className="muted" style={{ fontSize: 11 }}>tap for details ›</div>
          </div>
        </div>
        <div className="macros-mini">
          <span><i className="dot" style={{ background: "var(--protein)" }} />P {Math.round(Number(food.protein_g))}g</span>
          <span><i className="dot" style={{ background: "var(--carbs)" }} />C {Math.round(Number(food.carbs_g))}g</span>
          <span><i className="dot" style={{ background: "var(--fat)" }} />F {Math.round(Number(food.fat_g))}g</span>
        </div>
      </button>

      {open && (
        <DetailSheet
          title={<span style={{ textTransform: "capitalize" }}>{food.meal_label ?? "Meal"}</span>}
          onClose={() => setOpen(false)}
        >
          {food.raw_input && <p className="detail-lede">{food.raw_input}</p>}
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="meal" className="detail-photo" />
          )}

          <MacroTable
            calories={Number(food.calories)}
            protein_g={Number(food.protein_g)}
            carbs_g={Number(food.carbs_g)}
            fat_g={Number(food.fat_g)}
          />

          {items.length > 0 && (
            <>
              <div className="detail-h">Items</div>
              <div className="detail-items">
                {items.map((it, i) => (
                  <div key={i} className="detail-item">
                    <span className="detail-item-name">
                      {it.name}{it.grams != null ? ` · ${it.grams}g` : ""}
                    </span>
                    <span className="detail-item-macros">
                      {Math.round(it.calories)} kcal · P{it.protein_g} C{it.carbs_g} F{it.fat_g}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          {vitaminKeys.length > 0 && (
            <>
              <div className="detail-h">Vitamins &amp; minerals (est.)</div>
              <div className="pill-group">
                {vitaminKeys.map((k) => (
                  <span key={k} className="pill" style={{ fontWeight: 500 }}>{k}: {vitamins[k]}</span>
                ))}
              </div>
            </>
          )}

          <button
            className="btn btn-ghost detail-delete"
            onClick={() => {
              if (confirm("Delete this entry?")) {
                onDelete();
                setOpen(false);
              }
            }}
          >
            Delete entry
          </button>
        </DetailSheet>
      )}
    </>
  );
}

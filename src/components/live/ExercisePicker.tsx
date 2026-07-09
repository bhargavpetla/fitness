"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MUSCLE_GROUPS,
  MEDIA_ATTRIBUTION,
  loadLibrary,
  searchLibrary,
  equipmentOf,
  customToLibrary,
  thumbUrl,
  gifUrl,
  getRecents,
  pushRecent,
  type LibraryExercise,
} from "@/lib/exerciseLibrary";
import { fetchCustomExercises, addCustomExercise } from "@/lib/db";
import { useLiquidGlass } from "@/lib/liquidGlass";

// Full-screen exercise picker for the live logger.
// Flow: muscle group grid → filtered list (search + equipment chips) → detail
// (animation + how-to) → "Add to workout". Custom exercises can be created
// inline when something's missing and are stored in the user's library.

type Step = "muscle" | "list" | "detail" | "custom";

const LIST_CAP = 80;

export function ExercisePicker({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (e: LibraryExercise) => void;
}) {
  const [all, setAll] = useState<LibraryExercise[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [step, setStep] = useState<Step>("muscle");
  const [bodyPart, setBodyPart] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [equip, setEquip] = useState<string | null>(null);
  const [detail, setDetail] = useState<LibraryExercise | null>(null);
  const [showAll, setShowAll] = useState(false);

  const headRef = useRef<HTMLDivElement>(null);
  useLiquidGlass(headRef, { scale: -70, blur: 4, fallbackBlur: 14 });

  useEffect(() => {
    let on = true;
    Promise.all([loadLibrary(), fetchCustomExercises().catch(() => [])])
      .then(([lib, custom]) => {
        if (on) setAll([...custom.map(customToLibrary), ...lib]);
      })
      .catch(() => on && setLoadError(true));
    return () => {
      on = false;
    };
  }, []);

  const recents = useMemo(() => {
    if (!all) return [];
    const ids = getRecents();
    const byId = new Map(all.map((e) => [e.id, e]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as LibraryExercise[];
  }, [all]);

  // Global search from the muscle step drops straight into the list.
  const searching = query.trim().length > 0;
  const effectiveStep: Step = step === "muscle" && searching ? "list" : step;

  const pool = useMemo(() => {
    if (!all) return [];
    const base = searchLibrary(all, query, step === "muscle" ? null : bodyPart);
    return equip ? base.filter((e) => e.equipment === equip) : base;
  }, [all, query, bodyPart, equip, step]);

  const equipments = useMemo(
    () => (all ? equipmentOf(searchLibrary(all, "", step === "muscle" ? null : bodyPart)) : []),
    [all, bodyPart, step]
  );

  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of all ?? []) counts.set(e.body_part, (counts.get(e.body_part) ?? 0) + 1);
    return counts;
  }, [all]);

  function openGroup(key: string) {
    setBodyPart(key);
    setQuery("");
    setEquip(null);
    setShowAll(false);
    setStep("list");
  }

  function pick(e: LibraryExercise) {
    pushRecent(e.id);
    onPick(e);
  }

  const title =
    effectiveStep === "custom"
      ? "Add your own"
      : effectiveStep === "detail"
        ? ""
        : effectiveStep === "list"
          ? searching && step === "muscle"
            ? "Search"
            : (MUSCLE_GROUPS.find((g) => g.key === bodyPart)?.label ?? "Exercises")
          : "Pick an exercise";

  function back() {
    if (effectiveStep === "detail") {
      setDetail(null);
      setStep(searching || bodyPart ? "list" : "muscle");
    } else if (effectiveStep === "custom") {
      setStep("list");
    } else if (effectiveStep === "list") {
      setQuery("");
      setEquip(null);
      setStep("muscle");
    } else {
      onClose();
    }
  }

  return (
    <div className="picker" role="dialog" aria-modal="true">
      <div className="picker-head glass" ref={headRef}>
        <button className="icon-btn" onClick={back} aria-label="Back">‹</button>
        <span className="picker-title">{title}</span>
        <button className="icon-btn" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="picker-body">
        {!all && !loadError && (
          <div className="center-screen"><span className="spinner" style={{ borderTopColor: "var(--accent)" }} /></div>
        )}
        {loadError && (
          <div className="center-screen">
            <p className="muted">Could not load the exercise library. Check your connection.</p>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        )}

        {all && effectiveStep === "muscle" && (
          <>
            <input
              className="field picker-search"
              placeholder="Search any exercise…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              inputMode="search"
            />
            {recents.length > 0 && (
              <>
                <div className="picker-section">Recent</div>
                <div className="picker-recents">
                  {recents.map((e) => (
                    <button key={e.id} className="picker-recent" onClick={() => { setDetail(e); setStep("detail"); }}>
                      {thumbUrl(e) ? <img src={thumbUrl(e)!} alt="" loading="lazy" /> : <span className="picker-thumb-ph">✦</span>}
                      <span>{e.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            <div className="picker-section">Muscle</div>
            <div className="muscle-grid">
              {MUSCLE_GROUPS.map((g) => (
                <button key={g.key} className="muscle-card" onClick={() => openGroup(g.key)}>
                  <span className="muscle-icon">{g.icon}</span>
                  <span className="muscle-name">{g.label}</span>
                  <span className="muscle-hint">{g.hint}</span>
                  <span className="muscle-count">{groupCounts.get(g.key) ?? 0}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {all && effectiveStep === "list" && (
          <>
            <input
              className="field picker-search"
              placeholder={title === "Search" ? "Search any exercise…" : `Search ${title.toLowerCase()}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              inputMode="search"
              autoFocus={false}
            />
            {equipments.length > 1 && (
              <div className="equip-chips">
                <button className={`pill ${equip == null ? "on" : ""}`} onClick={() => setEquip(null)}>All</button>
                {equipments.map((eq) => (
                  <button key={eq} className={`pill ${equip === eq ? "on" : ""}`} onClick={() => setEquip(equip === eq ? null : eq)}>
                    {eq}
                  </button>
                ))}
              </div>
            )}

            {(showAll ? pool : pool.slice(0, LIST_CAP)).map((e) => (
              <button key={e.id} className="ex-row" onClick={() => { setDetail(e); setStep("detail"); }}>
                <span className="ex-row-thumb">
                  {thumbUrl(e) ? <img src={thumbUrl(e)!} alt="" loading="lazy" /> : <span className="picker-thumb-ph">✦</span>}
                </span>
                <span className="ex-row-text">
                  <span className="ex-row-name">{e.name}</span>
                  <span className="ex-row-sub">
                    {e.target || e.body_part} · {e.equipment}
                    {e.custom ? " · custom" : ""}
                  </span>
                </span>
                <span className="ex-row-go">›</span>
              </button>
            ))}

            {!showAll && pool.length > LIST_CAP && (
              <button className="btn btn-ghost" onClick={() => setShowAll(true)}>
                Show all {pool.length}
              </button>
            )}

            <button className="ex-row ex-row-add" onClick={() => setStep("custom")}>
              <span className="ex-row-thumb"><span className="picker-thumb-ph">＋</span></span>
              <span className="ex-row-text">
                <span className="ex-row-name">{pool.length === 0 ? `Can't find "${query.trim()}"?` : "Something missing?"}</span>
                <span className="ex-row-sub">Add your own exercise to the library</span>
              </span>
              <span className="ex-row-go">›</span>
            </button>
          </>
        )}

        {all && effectiveStep === "detail" && detail && (
          <ExerciseDetail exercise={detail} onAdd={() => pick(detail)} />
        )}

        {all && effectiveStep === "custom" && (
          <CustomExerciseForm
            defaultName={pool.length === 0 ? query.trim() : ""}
            defaultBodyPart={bodyPart}
            onCancel={() => setStep("list")}
            onCreated={(e) => {
              setAll((prev) => (prev ? [e, ...prev] : [e]));
              pick(e);
            }}
          />
        )}
      </div>
    </div>
  );
}

// ---- detail: animation + how-to + add ----

function ExerciseDetail({ exercise, onAdd }: { exercise: LibraryExercise; onAdd: () => void }) {
  const [showSteps, setShowSteps] = useState(false);
  const gif = gifUrl(exercise);

  return (
    <div className="ex-detail">
      <div className="ex-detail-hero">
        {gif ? (
          <img src={gif} alt={`${exercise.name} animation`} />
        ) : (
          <span className="ex-detail-hero-ph">✦</span>
        )}
      </div>
      <h2 className="ex-detail-name">{exercise.name}</h2>
      <div className="ex-detail-tags">
        <span className="pill on">{exercise.target || exercise.body_part}</span>
        {exercise.secondary.slice(0, 3).map((m) => (
          <span key={m} className="pill">{m}</span>
        ))}
        <span className="pill">{exercise.equipment}</span>
      </div>

      {exercise.steps.length > 0 && (
        <div className="ex-howto">
          <button className="ex-howto-toggle" onClick={() => setShowSteps((v) => !v)}>
            How to do it {showSteps ? "▴" : "▾"}
          </button>
          {showSteps && (
            <ol className="ex-howto-steps">
              {exercise.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          )}
        </div>
      )}

      <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={onAdd}>
        Add to workout
      </button>
      {gif && <p className="media-credit">{MEDIA_ATTRIBUTION}</p>}
    </div>
  );
}

// ---- custom exercise form ----

const CUSTOM_EQUIPMENT = ["body weight", "dumbbell", "barbell", "cable", "machine", "kettlebell", "band", "other"];

function CustomExerciseForm({
  defaultName,
  defaultBodyPart,
  onCancel,
  onCreated,
}: {
  defaultName: string;
  defaultBodyPart: string | null;
  onCancel: () => void;
  onCreated: (e: LibraryExercise) => void;
}) {
  const [name, setName] = useState(defaultName);
  const [group, setGroup] = useState(defaultBodyPart ?? "chest");
  const [equipment, setEquipment] = useState("body weight");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    const label = MUSCLE_GROUPS.find((g) => g.key === group)?.label ?? group;
    const row = await addCustomExercise({
      name: name.trim(),
      body_part: group,
      equipment,
      target: label.toLowerCase(),
    });
    setBusy(false);
    if (!row) {
      setError("Could not save. Try again.");
      return;
    }
    onCreated(customToLibrary(row));
  }

  return (
    <div className="custom-form">
      <p className="muted" style={{ fontSize: 14, marginTop: 0 }}>
        It'll be saved to your library and show up in the picker from now on.
      </p>
      <label className="label">Exercise name</label>
      <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Landmine Press" autoFocus />

      <label className="label">Muscle</label>
      <div className="pill-group">
        {MUSCLE_GROUPS.map((g) => (
          <button key={g.key} className={`pill ${group === g.key ? "on" : ""}`} onClick={() => setGroup(g.key)}>
            {g.icon} {g.label}
          </button>
        ))}
      </div>

      <label className="label">Equipment</label>
      <div className="pill-group">
        {CUSTOM_EQUIPMENT.map((eq) => (
          <button key={eq} className={`pill ${equipment === eq ? "on" : ""}`} onClick={() => setEquipment(eq)}>
            {eq}
          </button>
        ))}
      </div>

      {error && <p style={{ color: "#b42318", fontSize: 14 }}>{error}</p>}
      <div className="row">
        <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>
          {busy ? <span className="spinner" /> : "Save & add"}
        </button>
      </div>
    </div>
  );
}

"use client";

import type { MuscleActivation } from "@/lib/workout";

// Minimal anatomical activation map: a front + back body silhouette in neutral
// grey with muscle regions tinted matcha-green by activation intensity. Stylized
// (not medically precise) to stay clean and Apple-Health minimal. Driven by the
// MuscleActivation list computed in lib/workout.ts.

// Green fill at an opacity proportional to activation (with a floor so worked
// muscles are always visible). Untouched muscles stay neutral grey.
function fill(pct: number | undefined): string {
  if (!pct) return "#e6e8ea";
  const o = 0.25 + (Math.min(100, pct) / 100) * 0.75;
  return `rgba(47,122,77,${o.toFixed(2)})`;
}

export function BodyMap({ activation }: { activation: MuscleActivation[] }) {
  const m: Record<string, number> = {};
  for (const a of activation) m[a.muscle] = a.pct;

  // Side delts appear on both front and back; treat its tint for both shoulders.
  const chest = fill(m["Chest"]);
  const frontDelt = fill(Math.max(m["Front Delts"] ?? 0, (m["Side Delts"] ?? 0) * 0.7) || undefined);
  const sideBackDelt = fill(Math.max(m["Rear Delts"] ?? 0, (m["Side Delts"] ?? 0) * 0.7) || undefined);
  const biceps = fill(m["Biceps"]);
  const triceps = fill(m["Triceps"]);
  const core = fill(m["Core"]);
  const quads = fill(m["Quads"]);
  const hamstrings = fill(m["Hamstrings"]);
  const glutes = fill(m["Glutes"]);
  const calves = fill(m["Calves"]);
  const back = fill(m["Back"]);
  const traps = fill(m["Traps"]);
  const forearms = fill(m["Forearms"]);

  const body = "#f0f1f2";
  const stroke = "#d7dadd";

  return (
    <div className="bodymap">
      {/* FRONT */}
      <svg viewBox="0 0 120 260" className="bodymap-svg" aria-label="Front muscle activation">
        <g stroke={stroke} strokeWidth="0.8">
          {/* silhouette */}
          <circle cx="60" cy="18" r="11" fill={body} />
          <path d="M44 30 Q60 26 76 30 L80 70 Q80 86 74 100 L70 150 L50 150 L46 100 Q40 86 40 70 Z" fill={body} />
          {/* arms */}
          <path d="M44 34 L30 44 L24 92 L32 96 L40 60 Z" fill={body} />
          <path d="M76 34 L90 44 L96 92 L88 96 L80 60 Z" fill={body} />
          {/* legs */}
          <path d="M50 150 L48 210 L52 250 L60 250 L60 152 Z" fill={body} />
          <path d="M70 150 L72 210 L68 250 L60 250 L60 152 Z" fill={body} />
          {/* muscle regions */}
          <path d="M46 40 Q53 38 59 40 L59 56 Q52 58 47 54 Z" fill={chest} />
          <path d="M61 40 Q67 38 74 40 L73 54 Q68 58 61 56 Z" fill={chest} />
          <ellipse cx="42" cy="40" rx="7" ry="8" fill={frontDelt} />
          <ellipse cx="78" cy="40" rx="7" ry="8" fill={frontDelt} />
          <ellipse cx="33" cy="62" rx="5" ry="11" fill={biceps} />
          <ellipse cx="87" cy="62" rx="5" ry="11" fill={biceps} />
          <ellipse cx="28" cy="86" rx="4.5" ry="9" fill={forearms} />
          <ellipse cx="92" cy="86" rx="4.5" ry="9" fill={forearms} />
          <rect x="50" y="62" width="20" height="34" rx="5" fill={core} />
          <path d="M50 154 L49 196 L58 196 L59 154 Z" fill={quads} />
          <path d="M70 154 L71 196 L62 196 L61 154 Z" fill={quads} />
          <ellipse cx="52" cy="226" rx="4" ry="11" fill={calves} />
          <ellipse cx="68" cy="226" rx="4" ry="11" fill={calves} />
        </g>
      </svg>

      {/* BACK */}
      <svg viewBox="0 0 120 260" className="bodymap-svg" aria-label="Back muscle activation">
        <g stroke={stroke} strokeWidth="0.8">
          <circle cx="60" cy="18" r="11" fill={body} />
          <path d="M44 30 Q60 26 76 30 L80 70 Q80 86 74 100 L70 150 L50 150 L46 100 Q40 86 40 70 Z" fill={body} />
          <path d="M44 34 L30 44 L24 92 L32 96 L40 60 Z" fill={body} />
          <path d="M76 34 L90 44 L96 92 L88 96 L80 60 Z" fill={body} />
          <path d="M50 150 L48 210 L52 250 L60 250 L60 152 Z" fill={body} />
          <path d="M70 150 L72 210 L68 250 L60 250 L60 152 Z" fill={body} />
          {/* muscle regions */}
          <path d="M50 34 Q60 32 70 34 L66 46 Q60 48 54 46 Z" fill={traps} />
          <ellipse cx="42" cy="40" rx="7" ry="8" fill={sideBackDelt} />
          <ellipse cx="78" cy="40" rx="7" ry="8" fill={sideBackDelt} />
          <path d="M47 48 Q53 50 58 50 L58 78 L48 74 Q45 60 47 48 Z" fill={back} />
          <path d="M73 48 Q67 50 62 50 L62 78 L72 74 Q75 60 73 48 Z" fill={back} />
          <ellipse cx="33" cy="62" rx="5" ry="11" fill={triceps} />
          <ellipse cx="87" cy="62" rx="5" ry="11" fill={triceps} />
          <path d="M50 100 Q60 98 70 100 L68 118 Q60 120 52 118 Z" fill={glutes} />
          <path d="M50 154 L49 196 L58 196 L59 154 Z" fill={hamstrings} />
          <path d="M70 154 L71 196 L62 196 L61 154 Z" fill={hamstrings} />
          <ellipse cx="52" cy="226" rx="4" ry="11" fill={calves} />
          <ellipse cx="68" cy="226" rx="4" ry="11" fill={calves} />
        </g>
      </svg>
    </div>
  );
}

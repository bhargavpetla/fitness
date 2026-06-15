"use client";

import { AnimatedNumber } from "./AnimatedNumber";

// A single macro progress ring with its fixed hue. Fills toward `goal`.
export function MacroRing({
  label,
  value,
  goal,
  color,
  size = 58,
}: {
  label: string;
  value: number;
  goal: number;
  color: string;
  size?: number;
}) {
  const stroke = 6;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = goal > 0 ? Math.min(1, value / goal) : 0;
  const offset = circ * (1 - pct);

  return (
    <div className="ring">
      <svg width={size} height={size} aria-hidden>
        <circle className="ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="ring-fill"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="ring-num" style={{ color }}>
        <AnimatedNumber value={Math.round(value)} />
        <span className="muted">/{Math.round(goal)}</span>
      </span>
      <span className="ring-tag">{label}</span>
    </div>
  );
}

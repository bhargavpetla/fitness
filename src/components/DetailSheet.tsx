"use client";

import { useEffect, type ReactNode, type CSSProperties } from "react";

// A premium frosted-glass detail popup used across the app (food entry, meal,
// exercise how-to). Bottom-sheet on mobile, comfortably sized, tap-outside /
// the ✕ / Esc to close. Kept mostly opaque so the content — macro tables,
// recipes, steps — stays crisp and genuinely easy on the eyes, while the edge
// highlight and blur still read as liquid glass.
export function DetailSheet({
  title,
  onClose,
  children,
  accent,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  accent?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    // Lock background scroll while the sheet is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <>
      <div className="glass-sheet-backdrop" onClick={onClose} />
      <div
        className="glass-sheet"
        role="dialog"
        aria-modal="true"
        style={accent ? ({ "--sheet-accent": accent } as CSSProperties) : undefined}
      >
        <div className="glass-sheet-head">
          <span className="glass-sheet-grip" aria-hidden />
          <button className="glass-sheet-x" onClick={onClose} aria-label="Close">✕</button>
          {title && <div className="glass-sheet-title">{title}</div>}
        </div>
        <div className="glass-sheet-body">{children}</div>
      </div>
    </>
  );
}

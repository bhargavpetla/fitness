"use client";

// Top-slide nudge that auto-dismisses (parent controls timing) and is tappable to close.
export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="toast" role="status" onClick={onDismiss}>
      {message}
    </div>
  );
}

"use client";

// Tactile feedback engine — the Duolingo feel. Tiny synthesized sounds (no
// audio files, WebAudio only) plus vibration where the platform allows it.
// Everything fires from user gestures, so autoplay policy is satisfied; the
// AudioContext is created lazily on first use. A "sounds" preference in
// Settings mutes the audio (haptics stay — they're quieter than silence).

let ctx: AudioContext | null = null;
const MUTE_KEY = "fx-muted";

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    ctx ??= new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function fxMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setFxMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore */
  }
}

// One enveloped oscillator note. Short attack, exponential decay — the
// building block of every cue here.
function note(
  ac: AudioContext,
  {
    freq,
    to,
    type = "sine",
    at = 0,
    dur = 0.09,
    vol = 0.12,
  }: { freq: number; to?: number; type?: OscillatorType; at?: number; dur?: number; vol?: number }
) {
  const t0 = ac.currentTime + at;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(vol, t0 + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export type FxKind = "tap" | "pop" | "success" | "switch" | "remove" | "chirp";

// tap     — soft tick: tabs, chips, toggles
// pop     — satisfying blip: logging a set, adding an exercise, checking a meal
// success — rising two-note chime: day complete, workout saved, plan ready
// switch  — the mode flip: quick down-up sweep
// remove  — low thud: deletions, taking things back
// chirp   — Macha's happy squeak: petting the mascot
export function play(kind: FxKind): void {
  if (fxMuted()) return;
  const ac = audio();
  if (!ac) return;
  switch (kind) {
    case "tap":
      note(ac, { freq: 1900, type: "triangle", dur: 0.045, vol: 0.07 });
      break;
    case "pop":
      note(ac, { freq: 420, to: 940, type: "sine", dur: 0.1, vol: 0.14 });
      break;
    case "success":
      note(ac, { freq: 659, type: "sine", dur: 0.12, vol: 0.13 }); // E5
      note(ac, { freq: 880, type: "sine", at: 0.09, dur: 0.17, vol: 0.13 }); // A5
      note(ac, { freq: 1318, type: "sine", at: 0.09, dur: 0.17, vol: 0.05 }); // sparkle overtone
      break;
    case "switch":
      note(ac, { freq: 500, to: 260, type: "sine", dur: 0.08, vol: 0.1 });
      note(ac, { freq: 300, to: 900, type: "sine", at: 0.07, dur: 0.12, vol: 0.12 });
      break;
    case "remove":
      note(ac, { freq: 220, to: 120, type: "triangle", dur: 0.12, vol: 0.12 });
      break;
    case "chirp":
      // Two quick upward squeaks — small, bright, alive.
      note(ac, { freq: 880, to: 1420, type: "sine", dur: 0.07, vol: 0.11 });
      note(ac, { freq: 1180, to: 1760, type: "sine", at: 0.09, dur: 0.09, vol: 0.09 });
      break;
  }
}

// Vibration where the platform supports it (Android Chrome; iOS ignores it).
export function buzz(pattern: number | number[] = 8): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* ignore */
  }
}

// The standard combos — call these from handlers at the moment of state change.
export const fx = {
  tap: () => {
    play("tap");
    buzz(6);
  },
  pop: () => {
    play("pop");
    buzz(10);
  },
  success: () => {
    play("success");
    buzz([12, 40, 18]);
  },
  switch: () => {
    play("switch");
    buzz([8, 30, 12]);
  },
  remove: () => {
    play("remove");
    buzz(14);
  },
  chirp: () => {
    play("chirp");
    buzz([6, 24, 6]);
  },
};

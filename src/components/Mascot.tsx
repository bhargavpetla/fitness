"use client";

import { useEffect, useRef, useState } from "react";
import { fx } from "@/lib/fx";

// Macha, the app's pet — a Duolingo-style companion, built as a hand-rigged
// SVG character rather than image frames: every part (body, leaf, eyes, arms)
// is its own node, animated with CSS keyframes in globals.css using the
// classic principles — squash & stretch on the body, anticipation before the
// cheer jump, secondary action on the leaf, follow-through on the shadow.
// Design matched to the Gemini-generated reference set in public/mascot/.
//
// Macha is alive, not decorative:
//  - its eyes follow your finger/cursor
//  - pet it and it chirps, hops, and says something in character
//  - spam-pet it and it gets flustered
//  - it knows the time of day and the mood of the screen it's on (pose)

export type MascotPose = "hello" | "cheer" | "flex" | "zen" | "sleep";

// Palette sampled from the generated reference set (muted matcha body,
// dark-olive features, brighter sprout, rosy cheeks).
const BODY = "#a6bd75";
const BODY_DARK = "#93ab61";
const OUTLINE = "#71824a";
const BELLY = "#bcd08e";
const LEAF = "#7bb661";
const LEAF_LIGHT = "#94cc7a";
const INKY = "#46542e";
const CHEEK = "#f0959e";

// Macha's voice: confident, a little cheeky, always on your side.
const LINES: Record<MascotPose, string[]> = {
  hello: [
    "You're here! I was getting bored.",
    "Log it now, thank me later.",
    "I literally run on your streak.",
    "Psst. Protein first.",
    "I saved your spot. Both of them.",
  ],
  cheer: [
    "THAT'S what I'm talking about!",
    "You did the thing!!",
    "I'm not crying, you're crying.",
    "The streak looks good on you.",
  ],
  flex: [
    "Spot me? I'm going heavy.",
    "These aren't even my heavy leaves.",
    "One more rep. For me?",
    "Lift now, waddle later.",
  ],
  zen: [
    "Breathe in… and log your lunch.",
    "The plan is written. Trust it.",
    "Rest is training too. Deep, right?",
    "Shhh. I'm manifesting your PR.",
  ],
  sleep: [
    "Five more minutes…",
    "zzz… protein… zzz…",
    "Wake me when there's a streak.",
    "Even I rest on rest days.",
  ],
};

// When you keep poking it.
const FLUSTERED = [
  "Hehe, that tickles!",
  "Okay okay, I'm awake!",
  "Careful with the leaf!!",
  "Keep that up and I evolve. Maybe.",
];

function pickLine(pose: MascotPose): string {
  const pool = [...LINES[pose]];
  const h = new Date().getHours();
  if (pose === "hello" && h < 10) pool.push("Morning! Big day for logging.");
  if (pose === "hello" && h >= 21) pool.push("Late snack? I saw nothing.");
  return pool[Math.floor(Math.random() * pool.length)];
}

export function Mascot({
  pose = "hello",
  size = 104,
  bubble,
}: {
  pose?: MascotPose;
  size?: number;
  bubble?: string;
}) {
  const [excited, setExcited] = useState(false);
  const [say, setSay] = useState<string | null>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const hopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taps = useRef<number[]>([]);

  useEffect(
    () => () => {
      if (hopTimer.current) clearTimeout(hopTimer.current);
      if (sayTimer.current) clearTimeout(sayTimer.current);
    },
    []
  );

  function poke() {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 1800), now];
    const flustered = taps.current.length >= 3;
    if (flustered) {
      taps.current = [];
      fx.success();
      setSay(FLUSTERED[Math.floor(Math.random() * FLUSTERED.length)]);
    } else {
      fx.chirp();
      setSay(pickLine(pose));
    }
    setExcited(true);
    if (hopTimer.current) clearTimeout(hopTimer.current);
    hopTimer.current = setTimeout(() => setExcited(false), 750);
    if (sayTimer.current) clearTimeout(sayTimer.current);
    sayTimer.current = setTimeout(() => setSay(null), 2600);
  }

  // The eyes follow the pointer — small translation, big life.
  function track(e: React.PointerEvent<HTMLButtonElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    setLook({
      x: Math.max(-1, Math.min(1, dx)) * 1.9,
      y: Math.max(-1, Math.min(1, dy)) * 1.6,
    });
  }

  const closedEyes = pose === "zen" || pose === "sleep";
  const text = say ?? bubble;

  return (
    <div className="mascot">
      {text && (
        <div key={text} className={`mascot-bubble ${say ? "mascot-say" : ""}`}>
          {text}
        </div>
      )}
      <button
        className="mascot-tap"
        onClick={poke}
        onPointerMove={track}
        onPointerLeave={() => setLook({ x: 0, y: 0 })}
        aria-label="Pet Macha"
      >
        <svg
          className={`macha mascot-img macha-${pose} ${excited ? "macha-excite" : ""}`}
          width={size}
          height={size}
          viewBox="0 0 120 128"
          role="img"
          aria-hidden
        >
          {/* aura (zen only) — sits behind everything */}
          {pose === "zen" && <circle className="m-aura" cx="60" cy="76" r="45" fill="none" stroke="#b7a5ff" strokeWidth="3" />}

          {/* ground shadow — follows the jump (follow-through) */}
          <ellipse className="m-shadow" cx="60" cy="119" rx="26" ry="5.5" fill="#000" opacity="0.09" />

          {/* confetti (cheer only) */}
          {pose === "cheer" && (
            <g>
              <rect className="m-conf m-c1" x="26" y="16" width="5" height="5" rx="1" fill="#16a34a" />
              <circle className="m-conf m-c2" cx="46" cy="12" r="2.6" fill="#7c3aed" />
              <rect className="m-conf m-c3" x="62" y="10" width="5" height="5" rx="1" fill="#f5b800" />
              <circle className="m-conf m-c4" cx="82" cy="14" r="2.4" fill="#e0654a" />
              <rect className="m-conf m-c5" x="94" y="20" width="4.5" height="4.5" rx="1" fill="#7c3aed" />
              <circle className="m-conf m-c6" cx="36" cy="22" r="2.2" fill="#f5b800" />
            </g>
          )}

          {/* Zzz (sleep only) */}
          {pose === "sleep" && (
            <g fill="#7c8a93" fontWeight="800" fontFamily="inherit">
              <text className="m-z m-z1" x="86" y="54" fontSize="10">z</text>
              <text className="m-z m-z2" x="93" y="44" fontSize="13">z</text>
              <text className="m-z m-z3" x="101" y="33" fontSize="16">z</text>
            </g>
          )}

          {/* the character — everything that breathes and jumps together */}
          <g className="m-core">
            {/* leaf sprout — secondary action, sways against the body */}
            <g className="m-leaf">
              <path d="M60 48 C60 42 59 38 57 34" stroke={LEAF} strokeWidth="3.2" strokeLinecap="round" fill="none" />
              <ellipse cx="51" cy="30" rx="8.5" ry="4.8" fill={LEAF} stroke={OUTLINE} strokeWidth="1.4" transform="rotate(-32 51 30)" />
              <ellipse cx="64" cy="30" rx="6.5" ry="3.8" fill={LEAF_LIGHT} stroke={OUTLINE} strokeWidth="1.4" transform="rotate(28 64 30)" />
            </g>

            {/* tiny feet, peeking under the body */}
            <ellipse cx="46" cy="112" rx="7.5" ry="5" fill={BODY} stroke={OUTLINE} strokeWidth="2" />
            <ellipse cx="74" cy="112" rx="7.5" ry="5" fill={BODY} stroke={OUTLINE} strokeWidth="2" />

            {/* body blob */}
            <ellipse cx="60" cy="80" rx="36" ry="33" fill={BODY} stroke={OUTLINE} strokeWidth="2.4" />
            <ellipse cx="60" cy="91" rx="21" ry="13" fill={BELLY} opacity="0.55" />

            {/* arms, per pose */}
            {pose === "hello" && (
              <>
                <ellipse cx="25" cy="86" rx="6.5" ry="10" fill={BODY_DARK} stroke={OUTLINE} strokeWidth="2" transform="rotate(22 25 86)" />
                <g className="m-wave">
                  <ellipse cx="96" cy="64" rx="6.5" ry="11" fill={BODY_DARK} stroke={OUTLINE} strokeWidth="2" transform="rotate(-38 96 64)" />
                </g>
              </>
            )}
            {pose === "flex" && (
              <>
                <ellipse cx="25" cy="68" rx="6.5" ry="10.5" fill={BODY_DARK} stroke={OUTLINE} strokeWidth="2" transform="rotate(38 25 68)" />
                <g className="m-pump">
                  <ellipse cx="94" cy="66" rx="6.5" ry="10.5" fill={BODY_DARK} stroke={OUTLINE} strokeWidth="2" transform="rotate(-28 94 66)" />
                  <g transform="rotate(-22 99 54)">
                    <rect x="89" y="52" width="20" height="3.6" rx="1.8" fill="#6b56c9" />
                    <circle cx="89" cy="53.8" r="5" fill="#7c5cf0" />
                    <circle cx="109" cy="53.8" r="5" fill="#7c5cf0" />
                  </g>
                </g>
              </>
            )}
            {pose === "cheer" && (
              <>
                <ellipse cx="24" cy="62" rx="6.5" ry="11" fill={BODY_DARK} stroke={OUTLINE} strokeWidth="2" transform="rotate(42 24 62)" />
                <ellipse cx="96" cy="62" rx="6.5" ry="11" fill={BODY_DARK} stroke={OUTLINE} strokeWidth="2" transform="rotate(-42 96 62)" />
              </>
            )}
            {(pose === "zen" || pose === "sleep") && (
              <>
                <ellipse cx="31" cy="97" rx="6.5" ry="9.5" fill={BODY_DARK} stroke={OUTLINE} strokeWidth="2" transform="rotate(58 31 97)" />
                <ellipse cx="89" cy="97" rx="6.5" ry="9.5" fill={BODY_DARK} stroke={OUTLINE} strokeWidth="2" transform="rotate(-58 89 97)" />
              </>
            )}

            {/* face */}
            {closedEyes ? (
              // serene closed arcs, straight from the zen reference
              <g stroke={INKY} strokeWidth="2.6" strokeLinecap="round" fill="none">
                <path d="M41 72 Q47 77.5 53 72" />
                <path d="M67 72 Q73 77.5 79 72" />
              </g>
            ) : (
              <>
                {/* eyebrows */}
                <g stroke={INKY} strokeWidth="2.2" strokeLinecap="round" fill="none" opacity="0.85">
                  <path d="M41.5 61.5 Q47 59 52.5 61.5" />
                  <path d="M67.5 61.5 Q73 59 78.5 61.5" />
                </g>
                <g className="m-eyes">
                  <ellipse cx="47" cy="72" rx="7" ry="8" fill="#fff" stroke={OUTLINE} strokeWidth="1.4" />
                  <ellipse cx="73" cy="72" rx="7" ry="8" fill="#fff" stroke={OUTLINE} strokeWidth="1.4" />
                  {/* pupils track the pointer */}
                  <g style={{ transform: `translate(${look.x}px, ${look.y}px)`, transition: "transform 0.15s ease-out" }}>
                    <circle cx="48" cy="73" r="3.6" fill={INKY} />
                    <circle cx="74" cy="73" r="3.6" fill={INKY} />
                    <circle cx="46.6" cy="71" r="1.3" fill="#fff" />
                    <circle cx="72.6" cy="71" r="1.3" fill="#fff" />
                  </g>
                </g>
              </>
            )}
            <circle cx="40" cy="83" r="4.4" fill={CHEEK} opacity="0.55" />
            <circle cx="80" cy="83" r="4.4" fill={CHEEK} opacity="0.55" />
            {pose === "cheer" ? (
              <>
                <path d="M52 87 Q60 99 68 87 Q60 92 52 87 Z" fill="#5d4037" />
                <path d="M55.5 89.5 Q60 93.5 64.5 89.5 Q60 92 55.5 89.5 Z" fill={CHEEK} />
              </>
            ) : pose === "sleep" ? (
              <circle cx="60" cy="90" r="2.4" fill={INKY} opacity="0.75" />
            ) : (
              <>
                {/* small open smile with a hint of tongue, like the reference */}
                <path d="M54.5 87 Q60 93.5 65.5 87 Q60 90.5 54.5 87 Z" fill="#5d4037" />
                <path d="M57 88.6 Q60 91.2 63 88.6 Q60 90.2 57 88.6 Z" fill={CHEEK} />
              </>
            )}
          </g>
        </svg>
      </button>
    </div>
  );
}

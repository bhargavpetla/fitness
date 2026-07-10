"use client";

import { useEffect, useRef, useState } from "react";
import { fx } from "@/lib/fx";

// Macha, the app's pet — a hand-rigged SVG character (Duolingo approach:
// rigged vectors, not image frames). Parts animate with CSS keyframes in
// globals.css: squash & stretch breathing, leaf sway, blink cycle, waving,
// cheer jumps with a following shadow, waddle-walking, tears, topple-overs.
// Design matched to the Gemini-generated reference set in public/mascot/.
//
// Exports:
//  - MachaSvg   — the pure body (pose + mood + eye direction)
//  - useMachaBrain — the shared temperament: pet it and it chirps and talks;
//    keep going and it giggles; overdo it and it topples over, sees stars,
//    then bounces back up
//  - Mascot     — the inline pet used on empty states and hero moments

export type MascotPose = "hello" | "cheer" | "flex" | "zen" | "sleep";
export type MachaMood = "normal" | "laugh" | "cry" | "dizzy";

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
const TEAR = "#6fb5e8";

// ---- Macha's voice: confident, a little cheeky, always on your side ----

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

const GIGGLE_LINES = [
  "Hehe, that tickles!",
  "Okay okay, I'm awake!",
  "Careful with the leaf!!",
  "Keep that up and I evolve. Maybe.",
];

const FALL_LINES = ["…ow.", "The floor is nice, actually.", "I meant to do that."];
const DOWN_LINES = ["…five more minutes.", "Still down here.", "Respect the fallen."];
const RECOVER_LINES = ["I'm okay!!", "Nothing happened.", "The leaf broke my fall."];

export function pickLine(pose: MascotPose): string {
  const pool = [...LINES[pose]];
  const h = new Date().getHours();
  if (pose === "hello" && h < 10) pool.push("Morning! Big day for logging.");
  if (pose === "hello" && h >= 21) pool.push("Late snack? I saw nothing.");
  return pool[Math.floor(Math.random() * pool.length)];
}

const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];

// ---- the shared temperament ----
// Poke ladder inside a rolling 2.2s window: 1–2 pokes → chirp + a line;
// 3–5 → giggling laugh; 6+ → thud, topple over, stars; poking it while it's
// down gets you deadpan; it hops back up on its own.
export function useMachaBrain(pose: MascotPose) {
  const [excited, setExcited] = useState(false);
  const [fallen, setFallen] = useState(false);
  const [mood, setMood] = useState<MachaMood>("normal");
  const [say, setSay] = useState<string | null>(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const taps = useRef<number[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  function after(ms: number, run: () => void) {
    timers.current.push(setTimeout(run, ms));
  }
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  function speak(text: string, ms = 2600) {
    setSay(text);
    after(ms, () => setSay((s) => (s === text ? null : s)));
  }

  function hop() {
    setExcited(false);
    // restart the CSS animation on the next frame
    requestAnimationFrame(() => setExcited(true));
    after(760, () => setExcited(false));
  }

  function poke() {
    const now = Date.now();
    if (fallen) {
      speak(pick(DOWN_LINES), 1600);
      return;
    }
    taps.current = [...taps.current.filter((t) => now - t < 2200), now];
    const n = taps.current.length;
    if (n >= 6) {
      // over the line — it topples
      taps.current = [];
      fx.thud();
      setFallen(true);
      setMood("dizzy");
      speak(pick(FALL_LINES), 2400);
      after(3000, () => {
        setFallen(false);
        setMood("normal");
        hop();
        fx.chirp();
        speak(pick(RECOVER_LINES), 1800);
      });
      return;
    }
    if (n >= 3) {
      fx.giggle();
      setMood("laugh");
      speak(pick(GIGGLE_LINES));
      after(1500, () => setMood((m) => (m === "laugh" ? "normal" : m)));
    } else {
      fx.chirp();
      speak(pickLine(pose));
    }
    hop();
  }

  // The eyes follow the pointer — small translation, big life.
  function track(e: React.PointerEvent<HTMLElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    setLook({
      x: Math.max(-1, Math.min(1, dx)) * 1.9,
      y: Math.max(-1, Math.min(1, dy)) * 1.6,
    });
  }
  const unlook = () => setLook({ x: 0, y: 0 });

  return { excited, fallen, mood, say, look, poke, track, unlook, speak, setMood, hop };
}

// ---- the body ----

export function MachaSvg({
  pose,
  size = 104,
  excited = false,
  fallen = false,
  mood = "normal",
  walking = false,
  look = { x: 0, y: 0 },
}: {
  pose: MascotPose;
  size?: number;
  excited?: boolean;
  fallen?: boolean;
  mood?: MachaMood;
  walking?: boolean;
  look?: { x: number; y: number };
}) {
  const closedEyes = mood === "normal" && (pose === "zen" || pose === "sleep");
  const cls = [
    "macha",
    "mascot-img",
    `macha-${pose}`,
    excited ? "macha-excite" : "",
    fallen ? "macha-fallen" : "",
    walking ? "macha-walking" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <svg className={cls} width={size} height={size} viewBox="0 0 120 128" role="img" aria-hidden>
      {/* aura (zen only) — sits behind everything */}
      {pose === "zen" && mood === "normal" && (
        <circle className="m-aura" cx="60" cy="76" r="45" fill="none" stroke="#b7a5ff" strokeWidth="3" />
      )}

      {/* ground shadow — follows the jump (follow-through) */}
      <ellipse className="m-shadow" cx="60" cy="119" rx="26" ry="5.5" fill="#000" opacity="0.09" />

      {/* confetti (cheer only) */}
      {pose === "cheer" && !fallen && (
        <g>
          <rect className="m-conf m-c1" x="26" y="16" width="5" height="5" rx="1" fill="#16a34a" />
          <circle className="m-conf m-c2" cx="46" cy="12" r="2.6" fill="#7c3aed" />
          <rect className="m-conf m-c3" x="62" y="10" width="5" height="5" rx="1" fill="#f5b800" />
          <circle className="m-conf m-c4" cx="82" cy="14" r="2.4" fill="#e0654a" />
          <rect className="m-conf m-c5" x="94" y="20" width="4.5" height="4.5" rx="1" fill="#7c3aed" />
          <circle className="m-conf m-c6" cx="36" cy="22" r="2.2" fill="#f5b800" />
        </g>
      )}

      {/* stars circling after a fall */}
      {fallen && (
        <g fill="#f5b800">
          <text className="m-z m-z1" x="30" y="34" fontSize="12">✶</text>
          <text className="m-z m-z2" x="60" y="24" fontSize="10">✶</text>
          <text className="m-z m-z3" x="86" y="36" fontSize="13">✶</text>
        </g>
      )}

      {/* Zzz (sleep only) */}
      {pose === "sleep" && !fallen && (
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
        <g className="m-feet">
          <ellipse cx="46" cy="112" rx="7.5" ry="5" fill={BODY} stroke={OUTLINE} strokeWidth="2" />
          <ellipse cx="74" cy="112" rx="7.5" ry="5" fill={BODY} stroke={OUTLINE} strokeWidth="2" />
        </g>

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

        {/* ---- face, by mood ---- */}
        {mood === "dizzy" ? (
          // knocked-out crosses
          <g stroke={INKY} strokeWidth="2.8" strokeLinecap="round">
            <path d="M42.5 68 L51.5 77 M51.5 68 L42.5 77" />
            <path d="M68.5 68 L77.5 77 M77.5 68 L68.5 77" />
          </g>
        ) : mood === "cry" ? (
          <>
            {/* upset brows + shut-tight eyes + wobble frown + falling tears */}
            <g stroke={INKY} strokeWidth="2.2" strokeLinecap="round" fill="none">
              <path d="M42 62 Q47 64.5 52 63.5" />
              <path d="M68 63.5 Q73 64.5 78 62" />
              <path d="M41 73 Q47 70 53 73" />
              <path d="M67 73 Q73 70 79 73" />
            </g>
            <path className="m-tear m-tear1" d="M45 78 q-3 5 0 7 q3 -2 0 -7 Z" fill={TEAR} />
            <path className="m-tear m-tear2" d="M75 78 q-3 5 0 7 q3 -2 0 -7 Z" fill={TEAR} />
          </>
        ) : mood === "laugh" ? (
          // squeezed-happy arcs — the giggle face
          <g stroke={INKY} strokeWidth="2.6" strokeLinecap="round" fill="none">
            <path d="M41 73 Q47 67 53 73" />
            <path d="M67 73 Q73 67 79 73" />
          </g>
        ) : closedEyes ? (
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
        {mood === "cry" ? (
          <path d="M54 92 Q60 87 66 92" stroke={INKY} strokeWidth="2.4" strokeLinecap="round" fill="none" />
        ) : mood === "dizzy" ? (
          <circle cx="60" cy="90" r="2.6" fill={INKY} opacity="0.8" />
        ) : mood === "laugh" || pose === "cheer" ? (
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
  );
}

// ---- the inline pet (empty states, hero moments) ----

export function Mascot({
  pose = "hello",
  size = 104,
  bubble,
}: {
  pose?: MascotPose;
  size?: number;
  bubble?: string;
}) {
  const brain = useMachaBrain(pose);
  const text = brain.say ?? bubble;

  return (
    <div className="mascot">
      {text && (
        <div key={text} className={`mascot-bubble ${brain.say ? "mascot-say" : ""}`}>
          {text}
        </div>
      )}
      <button
        className="mascot-tap"
        onClick={brain.poke}
        onPointerMove={brain.track}
        onPointerLeave={brain.unlook}
        aria-label="Pet Macha"
      >
        <MachaSvg
          pose={pose}
          size={size}
          excited={brain.excited}
          fallen={brain.fallen}
          mood={brain.mood}
          look={brain.look}
        />
      </button>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MachaSvg, useMachaBrain, type MascotPose } from "@/components/Mascot";
import { fetchProfile, fetchStreak, fetchActiveGoal, fetchFoodLogs } from "@/lib/db";
import { todayStr } from "@/lib/date";
import type { FxKind } from "@/lib/fx";

// Macha as a live companion: it wanders along the top of the screen, greets
// you by name when you arrive, and actually knows how your day is going —
// it celebrates when you're closing in on your calorie/protein goal, cries a
// little when a streak breaks, cheers streak milestones, and reacts to what
// you do (logging, deleting, flipping to the Coach) by listening to the fx
// event stream. Turn it off any time in Settings → Sounds & feel.

const APP_COL = 520; // .app-shell max-width
const PET = 56;

// pose follows the room you're in
function poseFor(path: string): MascotPose {
  if (path.startsWith("/workout/live")) return "flex";
  if (path.startsWith("/coach")) return "zen";
  return "hello";
}

const ROUTE_LINES: Array<[RegExp, string[]]> = [
  [/^\/analytics/, ["These numbers? All you. I just watched.", "Graphs going the right way. Mostly."]],
  [/^\/workout\/live/, ["Form over ego. I'm watching.", "Rest between sets. I'll count."]],
  [/^\/coach/, ["The Coach and I talk. About you. Good things.", "Trust the plan. I proofread it."]],
  [/^\/settings/, ["Careful in here. This is where they can mute me."]],
];

const LOG_LINES = ["Logged! Proud of you.", "Another one banked.", "That's going on the fridge."];
const DELETE_LINES = ["Deleted. I saw nothing.", "We don't talk about that one."];
const SWITCH_LINES = ["Ooh, mode flip. Fancy.", "Tell the Coach I said hi."];

function greetingFor(name: string | null, streak: number): string {
  const h = new Date().getHours();
  const who = name ? `, ${name}` : "";
  const base =
    h < 5 ? `Up at this hour${who}? Midnight snack, our secret.` :
    h < 12 ? `Good morning${who}! Big day for logging.` :
    h < 18 ? `Good afternoon${who}. How's the protein going?` :
    `Good evening${who}. Let's close the day strong.`;
  return streak >= 3 ? `${base} Day ${streak} of the streak 🔥` : base;
}

export function MachaCompanion() {
  const pathname = usePathname() ?? "/";
  const hiddenRoute =
    pathname.startsWith("/login") || pathname.startsWith("/onboarding") || pathname.startsWith("/auth");

  const [enabled, setEnabled] = useState(true);
  const pose = poseFor(pathname);
  const brain = useMachaBrain(pose);
  const { speak, setMood, hop, fallen } = brain;

  // ---- wandering along the top ----
  const [x, setX] = useState(12);
  const [dir, setDir] = useState<1 | -1>(1);
  const [walking, setWalking] = useState(false);
  const [walkMs, setWalkMs] = useState(2000);
  const walkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consumedRef = useRef<{ calories: number; protein_g: number } | null>(null);
  const goalRef = useRef<{ calories: number; protein_g: number } | null>(null);
  const lastAutoLine = useRef(0);
  const lastRecheck = useRef(0);

  // respect the Settings toggle, live
  useEffect(() => {
    const read = () => {
      try {
        setEnabled(localStorage.getItem("macha-off") !== "1");
      } catch {
        setEnabled(true);
      }
    };
    read();
    window.addEventListener("macha-pref", read);
    window.addEventListener("storage", read);
    return () => {
      window.removeEventListener("macha-pref", read);
      window.removeEventListener("storage", read);
    };
  }, []);

  const colLeft = useCallback(() => {
    if (typeof window === "undefined") return 0;
    return Math.max(0, (window.innerWidth - APP_COL) / 2);
  }, []);

  const stroll = useCallback(() => {
    if (typeof window === "undefined") return;
    const width = Math.min(window.innerWidth, APP_COL);
    const target = 8 + Math.random() * Math.max(40, width - PET - 20);
    setX((cur) => {
      const dist = Math.abs(target - cur);
      const ms = Math.max(900, Math.min(6000, dist * 22)); // steady waddle pace
      setDir(target > cur ? 1 : -1);
      setWalkMs(ms);
      setWalking(true);
      if (walkTimer.current) clearTimeout(walkTimer.current);
      walkTimer.current = setTimeout(() => setWalking(false), ms + 80);
      return target;
    });
  }, []);

  // wander every so often; sit still while fallen
  useEffect(() => {
    if (!enabled || hiddenRoute) return;
    const id = setInterval(() => {
      if (fallen) return;
      const roll = Math.random();
      if (roll < 0.45) stroll();
      else if (roll < 0.6) hop(); // little idle bounce
    }, 14000);
    const first = setTimeout(stroll, 3500);
    return () => {
      clearInterval(id);
      clearTimeout(first);
      if (walkTimer.current) clearTimeout(walkTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hiddenRoute, fallen]);

  // one auto-line at a time, spaced out — a pet, not a pop-up storm
  const autoSay = useCallback(
    (text: string, minGapMs = 18000) => {
      const now = Date.now();
      if (now - lastAutoLine.current < minGapMs) return;
      lastAutoLine.current = now;
      speak(text, 3400);
    },
    [speak]
  );

  // ---- it knows your day: greeting, streaks, goals ----
  const recheckGoal = useCallback(async (announce: boolean) => {
    const now = Date.now();
    if (now - lastRecheck.current < 15000) return;
    lastRecheck.current = now;
    try {
      const foods = await fetchFoodLogs(todayStr());
      const consumed = foods.reduce(
        (a, f) => ({ calories: a.calories + Number(f.calories), protein_g: a.protein_g + Number(f.protein_g) }),
        { calories: 0, protein_g: 0 }
      );
      consumedRef.current = consumed;
      const goal = goalRef.current;
      if (!goal || !announce) return;
      const calPct = consumed.calories / goal.calories;
      const proteinDone = consumed.protein_g >= goal.protein_g;
      const nearCal = calPct >= 0.88 && calPct <= 1.06;
      if ((proteinDone || nearCal) && !sessionStorage.getItem("macha-goal-cheered")) {
        sessionStorage.setItem("macha-goal-cheered", "1");
        setMood("laugh");
        hop();
        autoSay(
          proteinDone
            ? `Protein goal DONE. ${Math.round(consumed.protein_g)}g. I'm so proud.`
            : `${Math.max(0, Math.round(goal.calories - consumed.calories))} kcal from goal. Stick the landing!`,
          0
        );
        setTimeout(() => setMood("normal"), 2600);
      }
    } catch {
      /* quiet pet */
    }
  }, [autoSay, hop, setMood]);

  useEffect(() => {
    if (!enabled || hiddenRoute) return;
    let on = true;
    (async () => {
      try {
        const [profile, streak, goal] = await Promise.all([fetchProfile(), fetchStreak(), fetchActiveGoal()]);
        if (!on) return;
        if (goal) goalRef.current = { calories: Number(goal.calories), protein_g: Number(goal.protein_g) };
        const cur = streak?.current_streak ?? 0;
        const everLogged = (streak?.total_days_logged ?? 0) > 0;

        if (!sessionStorage.getItem("macha-greeted")) {
          sessionStorage.setItem("macha-greeted", "1");
          if (cur === 0 && everLogged) {
            // the streak broke — Macha takes it personally
            setMood("cry");
            speak("Our streak… I'm fine. We rebuild today.", 4200);
            setTimeout(() => setMood("normal"), 4200);
          } else if ([7, 30, 50, 100].includes(cur)) {
            setMood("laugh");
            hop();
            speak(`${cur} DAYS${profile?.first_name ? `, ${profile.first_name}` : ""}! You legend.`, 4200);
            setTimeout(() => setMood("normal"), 2600);
          } else {
            speak(greetingFor(profile?.first_name ?? null, cur), 4200);
          }
        }
        await recheckGoal(false);
      } catch {
        /* quiet pet */
      }
    })();
    return () => {
      on = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hiddenRoute]);

  // ---- reacts to what you do, via the fx event stream ----
  useEffect(() => {
    if (!enabled || hiddenRoute) return;
    const onFx = (e: Event) => {
      const kind = (e as CustomEvent<FxKind>).detail;
      if (kind === "success") {
        setMood("laugh");
        hop();
        autoSay(LOG_LINES[Math.floor(Math.random() * LOG_LINES.length)], 25000);
        setTimeout(() => setMood("normal"), 2400);
        void recheckGoal(true);
      } else if (kind === "pop") {
        if (Math.random() < 0.35) hop();
        void recheckGoal(true);
      } else if (kind === "remove") {
        autoSay(DELETE_LINES[Math.floor(Math.random() * DELETE_LINES.length)], 30000);
      } else if (kind === "switch") {
        autoSay(SWITCH_LINES[Math.floor(Math.random() * SWITCH_LINES.length)], 30000);
      }
    };
    window.addEventListener("fx-play", onFx);
    return () => window.removeEventListener("fx-play", onFx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, hiddenRoute]);

  // a word when you wander into a new room (sometimes)
  useEffect(() => {
    if (!enabled || hiddenRoute) return;
    for (const [re, lines] of ROUTE_LINES) {
      if (re.test(pathname) && Math.random() < 0.5) {
        autoSay(lines[Math.floor(Math.random() * lines.length)], 15000);
        break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, enabled, hiddenRoute]);

  if (!enabled || hiddenRoute) return null;

  return (
    <div className="macha-companion" aria-hidden={false}>
      <div
        className="macha-companion-walker"
        style={{
          transform: `translateX(${colLeft() + x}px)`,
          transition: `transform ${walkMs}ms linear`,
        }}
      >
        <button
          className="mascot-tap"
          onClick={brain.poke}
          onPointerMove={brain.track}
          onPointerLeave={brain.unlook}
          aria-label="Pet Macha"
        >
          <span style={{ display: "block", transform: `scaleX(${dir})` }}>
            <MachaSvg
              pose={pose}
              size={PET}
              excited={brain.excited}
              fallen={brain.fallen}
              mood={brain.mood}
              walking={walking}
              look={brain.look}
            />
          </span>
        </button>
        {brain.say && (
          <div key={brain.say} className="mascot-bubble mascot-say below">
            {brain.say}
          </div>
        )}
      </div>
    </div>
  );
}

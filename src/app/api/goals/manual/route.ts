import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Settings "Edit daily target": the user types their own calories/macros and we
// write them as a new active versioned goal. No AI involved — history untouched,
// the previous goal is just deactivated. Body-fat / body-type reads from the
// prior goal are carried over so the Settings card still shows them.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: {
    calories?: number;
    protein_g?: number;
    carbs_g?: number;
    fat_g?: number;
    goal_type?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const calories = num(body.calories);
  const protein_g = num(body.protein_g);
  const carbs_g = num(body.carbs_g);
  const fat_g = num(body.fat_g);

  // Basic sanity bounds so a typo can't write a nonsensical target.
  if (calories < 800 || calories > 6000) {
    return NextResponse.json({ error: "Calories should be between 800 and 6000." }, { status: 400 });
  }
  if (protein_g < 0 || protein_g > 400 || carbs_g < 0 || carbs_g > 900 || fat_g < 0 || fat_g > 300) {
    return NextResponse.json({ error: "Those macros look out of range." }, { status: 400 });
  }

  const supabase = await createServerSupabase();

  // Carry forward the body-fat / body-type reads from the current active goal.
  const { data: prev } = await supabase
    .from("goals")
    .select("body_fat_estimate, body_type_read, goal_type")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  await supabase.from("goals").update({ is_active: false }).eq("user_id", user.id);
  const { error } = await supabase.from("goals").insert({
    user_id: user.id,
    calories,
    protein_g,
    carbs_g,
    fat_g,
    goal_type: body.goal_type || prev?.goal_type || "maintain",
    source: "manual_settings",
    body_fat_estimate: prev?.body_fat_estimate ?? null,
    body_type_read: prev?.body_type_read ?? null,
    notes: "Manually edited daily target.",
    is_active: true,
  });
  if (error) return NextResponse.json({ error: "Could not save target." }, { status: 500 });

  return NextResponse.json({ ok: true });
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

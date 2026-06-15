import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

// User accepted the check-in proposal — write a new active versioned goal.
// Old goals stay in the table; old food logs remain tied to their original goal.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let g: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    goal_type?: string;
    body_fat_estimate?: string;
    body_type_read?: string;
    notes?: string;
  };
  try {
    g = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!g.calories || !g.protein_g) {
    return NextResponse.json({ error: "Incomplete goal." }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  await supabase.from("goals").update({ is_active: false }).eq("user_id", user.id);
  const { error } = await supabase.from("goals").insert({
    user_id: user.id,
    calories: g.calories,
    protein_g: g.protein_g,
    carbs_g: g.carbs_g,
    fat_g: g.fat_g,
    goal_type: g.goal_type ?? "auto",
    source: "7day_checkin",
    body_fat_estimate: g.body_fat_estimate ?? null,
    body_type_read: g.body_type_read ?? null,
    notes: g.notes ?? null,
    is_active: true,
  });
  if (error) return NextResponse.json({ error: "Could not save." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

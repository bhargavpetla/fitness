import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Writes the onboarding goal after the user reviewed/edited the AI's proposal,
// then marks the profile onboarded. Values come from the (editable) summary screen.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let g: {
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    goal_type?: string;
    activity_level?: string;
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
    source: "onboarding",
    activity_level: g.activity_level ?? null,
    body_fat_estimate: g.body_fat_estimate ?? null,
    body_type_read: g.body_type_read ?? null,
    notes: g.notes ?? null,
    is_active: true,
  });
  if (error) {
    console.error(error);
    return NextResponse.json({ error: "Could not save goal." }, { status: 500 });
  }

  await supabase.from("profiles").update({ onboarded: true }).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}

import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import { analyzeBody } from "@/lib/ai/anthropic";
import { loadStoredMedicalDocuments } from "@/lib/medical-docs";

export const runtime = "nodejs";
export const maxDuration = 45;

// Settings "Refresh goals": recompute macros from current profile values (optionally
// without new photos) and write a new active versioned goal. History untouched.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { weight_kg?: number; goal_type?: string; goal_note?: string; photos?: string[] };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const supabase = await createServerSupabase();
  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const { data: lastWeigh } = await supabase
    .from("weigh_ins")
    .select("weight_kg")
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const weight = body.weight_kg ?? lastWeigh?.weight_kg;
  if (!weight) {
    return NextResponse.json({ error: "Need a current weight to recompute." }, { status: 400 });
  }
  if (body.weight_kg) {
    await supabase.from("weigh_ins").insert({ user_id: user.id, weight_kg: body.weight_kg });
  }

  try {
    const medicalDocs = await loadStoredMedicalDocuments(supabase, user.id);
    const analysis = await analyzeBody({
      age: profile?.age ?? null,
      height_cm: profile?.height_cm ?? null,
      weight_kg: Number(weight),
      sex: profile?.sex ?? null,
      build_note: profile?.build_note ?? null,
      goal_type: body.goal_type ?? "auto",
      goal_note: body.goal_note ?? null,
      photos: body.photos ?? [],
      medical_docs: medicalDocs,
    });

    await supabase.from("goals").update({ is_active: false }).eq("user_id", user.id);
    const { error } = await supabase.from("goals").insert({
      user_id: user.id,
      calories: analysis.calories,
      protein_g: analysis.protein_g,
      carbs_g: analysis.carbs_g,
      fat_g: analysis.fat_g,
      goal_type: analysis.goal_type,
      source: "manual_settings",
      body_fat_estimate: analysis.body_fat_estimate,
      body_type_read: analysis.body_type_read,
      notes: analysis.rationale,
      is_active: true,
    });
    if (error) return NextResponse.json({ error: "Could not save goal." }, { status: 500 });
    return NextResponse.json({ analysis });
  } catch (e) {
    console.error("goals/refresh failed:", e);
    return NextResponse.json({ error: "Refresh failed." }, { status: 502 });
  }
}

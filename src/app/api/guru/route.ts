import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import { askGuru } from "@/lib/ai/gemini";

export const runtime = "nodejs";
export const maxDuration = 30;

// Context-aware diet chat. Pulls the user's active goal + today's intake server-side
// so answers account for what's left in their day.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let question = "", history: Array<{ role: "user" | "model"; text: string }> = [];
  try {
    ({ question = "", history = [] } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!question.trim()) {
    return NextResponse.json({ error: "Ask a question." }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD local

  const [{ data: goal }, { data: profile }, { data: foods }] = await Promise.all([
    supabase.from("goals").select("calories,protein_g,carbs_g,fat_g").eq("is_active", true).maybeSingle(),
    supabase.from("profiles").select("first_name").maybeSingle(),
    supabase.from("food_logs").select("calories,protein_g,carbs_g,fat_g").eq("date", today),
  ]);

  const consumed = (foods ?? []).reduce(
    (a, f) => ({
      calories: a.calories + Number(f.calories),
      protein_g: a.protein_g + Number(f.protein_g),
      carbs_g: a.carbs_g + Number(f.carbs_g),
      fat_g: a.fat_g + Number(f.fat_g),
    }),
    { calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0 }
  );

  try {
    const answer = await askGuru(
      question,
      {
        goal: goal
          ? {
              calories: Number(goal.calories),
              protein_g: Number(goal.protein_g),
              carbs_g: Number(goal.carbs_g),
              fat_g: Number(goal.fat_g),
            }
          : null,
        consumed,
        name: profile?.first_name ?? null,
      },
      history.slice(-8)
    );
    return NextResponse.json({ answer });
  } catch (e) {
    console.error("guru failed:", e);
    return NextResponse.json({ error: "Guru is thinking too hard. Try again." }, { status: 502 });
  }
}

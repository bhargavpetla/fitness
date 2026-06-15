import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { parseExercise } from "@/lib/ai/gemini";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw_input = "";
  try {
    ({ raw_input = "" } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!raw_input.trim()) {
    return NextResponse.json({ error: "Type your workout." }, { status: 400 });
  }

  try {
    const result = await parseExercise(raw_input);
    return NextResponse.json(result);
  } catch (e) {
    console.error("exercise/parse failed:", e);
    return NextResponse.json({ error: "Could not parse that workout." }, { status: 502 });
  }
}

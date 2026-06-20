import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { parseFood } from "@/lib/ai/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

// Server-only: text (+ optional base64 photo) -> Gemini grounded -> structured macros.
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let raw_input = "", photo: string | undefined;
  try {
    ({ raw_input = "", photo } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  if (!raw_input.trim() && !photo) {
    return NextResponse.json({ error: "Type what you ate or attach a photo." }, { status: 400 });
  }

  try {
    const result = await parseFood(raw_input, photo);
    return NextResponse.json(result);
  } catch (e) {
    console.error("food/parse failed:", e);
    return NextResponse.json({ error: "Could not read that. Try rephrasing." }, { status: 502 });
  }
}

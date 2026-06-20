import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import { generateIllustration } from "@/lib/ai/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

// Per-exercise illustration, generated once and cached permanently in the user's
// private Storage. Future workouts reuse the cached image; we never regenerate.
// Keyed by a slug of the exercise name so "Incline Dumbbell Press" is one image
// forever, shared across all sessions that include it.
const STYLE =
  "flat minimalist vector illustration, pure white background, single matcha-green (#2F7A4D) accent with soft grey line work, a single person performing the exercise, calm and clean, no text, centered, generous negative space";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let name = "", muscle = "";
  try {
    ({ name = "", muscle = "" } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const slug = slugify(name);
  if (!slug) return NextResponse.json({ error: "Missing exercise name." }, { status: 400 });

  const supabase = await createServerSupabase();
  const path = `${user.id}/exercises/${slug}.png`;

  // Already cached? Return it without re-billing.
  const { data: existing } = await supabase.storage.from("photos").createSignedUrl(path, 60 * 60 * 24 * 7);
  if (existing?.signedUrl) return NextResponse.json({ url: existing.signedUrl, cached: true });

  const prompt = `${STYLE}. The exercise is "${name}"${muscle ? `, which trains the ${muscle}` : ""}. Show correct form in a simple side or three-quarter view.`;
  const b64 = await generateIllustration(prompt);
  if (!b64) return NextResponse.json({ url: null });

  const bytes = Buffer.from(b64, "base64");
  const { error } = await supabase.storage
    .from("photos")
    .upload(path, bytes, { contentType: "image/png", upsert: true });
  if (error) return NextResponse.json({ url: null });

  const { data: signed } = await supabase.storage.from("photos").createSignedUrl(path, 60 * 60 * 24 * 7);
  return NextResponse.json({ url: signed?.signedUrl ?? null, cached: false });
}

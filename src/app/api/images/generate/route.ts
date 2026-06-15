import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import { generateIllustration } from "@/lib/ai/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

// One-time illustration generation. Generates the consistent set, uploads each to
// the user's Storage folder, and returns public-ish signed URLs. Skips ones that
// already exist so it never re-bills on repeat calls.
const STYLE =
  "flat minimalist vector illustration, pure white background, single matcha-green (#2F7A4D) accent, soft, calm, no text, centered, lots of negative space";

const SET: Record<string, string> = {
  onboarding: `${STYLE}. A minimalist figure mid-lift, confident and clean.`,
  empty: `${STYLE}. A simple empty plate with a sprig of greenery, inviting.`,
  rest: `${STYLE}. A calm reclining moon-and-cushion motif suggesting rest and recovery.`,
  "badge-7": `${STYLE}. A small circular achievement badge with the numeral 7 implied by 7 dots, celebratory but calm.`,
  "badge-14": `${STYLE}. A small circular achievement badge for two weeks, laurel motif.`,
  "badge-30": `${STYLE}. A small circular achievement badge for a month, a single bold ring.`,
  "badge-60": `${STYLE}. A small circular achievement badge for sixty days, layered rings.`,
  "badge-100": `${STYLE}. A celebratory circular badge for one hundred days, a gentle starburst.`,
};

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let only: string[] | undefined;
  try {
    ({ only } = await req.json());
  } catch {
    /* generate all */
  }

  const supabase = await createServerSupabase();
  const keys = only?.length ? only.filter((k) => k in SET) : Object.keys(SET);
  const results: Record<string, string | null> = {};

  for (const key of keys) {
    const path = `${user.id}/art/${key}.png`;
    // Skip if already generated.
    const { data: existing } = await supabase.storage
      .from("photos")
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    if (existing?.signedUrl) {
      results[key] = existing.signedUrl;
      continue;
    }

    const b64 = await generateIllustration(SET[key]);
    if (!b64) {
      results[key] = null;
      continue;
    }
    const bytes = Buffer.from(b64, "base64");
    const { error } = await supabase.storage
      .from("photos")
      .upload(path, bytes, { contentType: "image/png", upsert: true });
    if (error) {
      results[key] = null;
      continue;
    }
    const { data: signed } = await supabase.storage
      .from("photos")
      .createSignedUrl(path, 60 * 60 * 24 * 7);
    results[key] = signed?.signedUrl ?? null;
  }

  return NextResponse.json({ images: results });
}

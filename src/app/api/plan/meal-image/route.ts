import { NextResponse } from "next/server";
import { getUser, createAdminSupabase } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { generateFoodImage } from "@/lib/ai/gemini";

export const runtime = "nodejs";
export const maxDuration = 60;

// Serves an AI-Coach dish photo, cached once in the public `food-media` bucket
// (shared across users, so a dish is only ever fetched/generated once):
//   1. If already cached, return it.
//   2. If a dataset source image is given (Archana's Kitchen), download + self-host it.
//   3. Otherwise generate a photo with the image model and cache that.
// Any failure falls back to the source URL or null, so the UI never breaks.

const ALLOWED_HOSTS = /(^|\.)archanaskitchen\.com$/i;

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let key = "";
  let src = "";
  let name = "";
  let desc = "";
  try {
    const body = await req.json();
    key = String(body?.key ?? "").replace(/[^a-z0-9-]/g, "").slice(0, 80);
    src = String(body?.src ?? "");
    name = String(body?.name ?? "").slice(0, 120);
    desc = String(body?.desc ?? "").slice(0, 200);
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!key) return NextResponse.json({ error: "key required." }, { status: 400 });

  const env = serverEnv();
  const path = `dishes/${key}.jpg`;
  const publicUrl = `${env.supabaseUrl}/storage/v1/object/public/food-media/${path}`;

  // 1. Already cached?
  try {
    const head = await fetch(publicUrl, { method: "HEAD" });
    if (head.ok) return NextResponse.json({ url: publicUrl });
  } catch {
    /* fall through */
  }

  const admin = createAdminSupabase();

  // 2. Dataset image — download the source and self-host it.
  if (src) {
    try {
      const srcUrl = new URL(src);
      if (srcUrl.protocol === "https:" && ALLOWED_HOSTS.test(srcUrl.hostname)) {
        const res = await fetch(srcUrl, { headers: { accept: "image/*" } });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length >= 500 && buf.length <= 4_000_000) {
            const { error } = await admin.storage.from("food-media").upload(path, buf, {
              contentType: res.headers.get("content-type") ?? "image/jpeg",
              cacheControl: "31536000",
              upsert: true,
            });
            if (!error) return NextResponse.json({ url: publicUrl });
          }
        }
      }
    } catch (e) {
      console.warn("meal-image dataset cache failed, will try generation:", e);
    }
  }

  // 3. Generate a photo for dishes the dataset doesn't cover.
  if (name) {
    try {
      const b64 = await generateFoodImage(name, desc);
      if (b64) {
        const buf = Buffer.from(b64, "base64");
        const { error } = await admin.storage.from("food-media").upload(path, buf, {
          contentType: "image/png",
          cacheControl: "31536000",
          upsert: true,
        });
        if (!error) return NextResponse.json({ url: publicUrl });
      }
    } catch (e) {
      console.warn("meal-image generation failed:", e);
    }
  }

  return NextResponse.json({ url: src || null });
}

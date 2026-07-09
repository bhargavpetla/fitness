import { NextResponse } from "next/server";
import { getUser, createAdminSupabase } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 30;

// Lazily self-hosts AI-Coach dish photos: on first view a dish image is
// downloaded from the recipe dataset's source and cached into the public
// `food-media` bucket; afterwards the app serves its own copy. If anything
// fails (bucket missing, source down) we fall back to the source URL so the
// UI never breaks.

const ALLOWED_HOSTS = /(^|\.)archanaskitchen\.com$/i;

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let key = "";
  let src = "";
  try {
    const body = await req.json();
    key = String(body?.key ?? "").replace(/[^a-z0-9-]/g, "").slice(0, 80);
    src = String(body?.src ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!key || !src) return NextResponse.json({ error: "key and src required." }, { status: 400 });

  let srcUrl: URL;
  try {
    srcUrl = new URL(src);
  } catch {
    return NextResponse.json({ error: "Bad src." }, { status: 400 });
  }
  if (srcUrl.protocol !== "https:" || !ALLOWED_HOSTS.test(srcUrl.hostname)) {
    return NextResponse.json({ error: "Source not allowed." }, { status: 400 });
  }

  const env = serverEnv();
  const path = `dishes/${key}.jpg`;
  const publicUrl = `${env.supabaseUrl}/storage/v1/object/public/food-media/${path}`;

  // Already cached?
  try {
    const head = await fetch(publicUrl, { method: "HEAD" });
    if (head.ok) return NextResponse.json({ url: publicUrl });
  } catch {
    /* fall through to caching attempt */
  }

  try {
    const res = await fetch(srcUrl, { headers: { accept: "image/*" } });
    if (!res.ok) throw new Error(`source ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500 || buf.length > 4_000_000) throw new Error("suspicious image size");

    const admin = createAdminSupabase();
    const { error } = await admin.storage.from("food-media").upload(path, buf, {
      contentType: res.headers.get("content-type") ?? "image/jpeg",
      cacheControl: "31536000",
      upsert: true,
    });
    if (error) throw error;
    return NextResponse.json({ url: publicUrl });
  } catch (e) {
    console.warn("meal-image cache failed, falling back to source:", e);
    return NextResponse.json({ url: src });
  }
}

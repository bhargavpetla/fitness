"use client";

import { createClient } from "@/lib/supabase/client";

// Reads a File into a compressed base64 data URL (max edge ~1280px) so AI payloads
// stay small. Used for both AI calls and Storage uploads.
export function fileToDataUrl(file: File, maxEdge = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Uploads a data URL to the user's private Storage folder, returns the storage path.
export async function uploadPhoto(dataUrl: string, kind: "food" | "progress"): Promise<string | null> {
  const sb = createClient();
  const { data: u } = await sb.auth.getUser();
  if (!u.user) return null;
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl);
  if (!m) return null;
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  const path = `${u.user.id}/${kind}/${Date.now()}.jpg`;
  const { error } = await sb.storage.from("photos").upload(path, bytes, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) {
    console.error(error);
    return null;
  }
  return path;
}

// Resolves a stored path to a temporary signed URL for display.
export async function signedUrl(path: string, seconds = 3600): Promise<string | null> {
  const sb = createClient();
  const { data } = await sb.storage.from("photos").createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

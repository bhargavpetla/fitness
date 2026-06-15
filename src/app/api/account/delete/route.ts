import { NextResponse } from "next/server";
import { createAdminSupabase, getUser } from "@/lib/supabase/server";
import { MEDICAL_DOCUMENTS_BUCKET } from "@/lib/medical-docs";

export const runtime = "nodejs";

const STORAGE_BUCKETS = ["photos", MEDICAL_DOCUMENTS_BUCKET];

export async function POST() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminSupabase();

  try {
    await Promise.all(STORAGE_BUCKETS.map((bucket) => deleteStoragePrefix(admin, bucket, user.id)));
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("account/delete failed:", e);
    return NextResponse.json({ error: "Could not delete account." }, { status: 500 });
  }
}

async function deleteStoragePrefix(admin: ReturnType<typeof createAdminSupabase>, bucket: string, prefix: string) {
  const paths = await listStoragePaths(admin, bucket, prefix);
  if (paths.length) {
    await admin.storage.from(bucket).remove(paths);
  }
}

async function listStoragePaths(
  admin: ReturnType<typeof createAdminSupabase>,
  bucket: string,
  prefix: string
): Promise<string[]> {
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return [];

  const paths: string[] = [];
  for (const item of data) {
    const path = `${prefix}/${item.name}`;
    if (item.id) {
      paths.push(path);
    } else {
      paths.push(...(await listStoragePaths(admin, bucket, path)));
    }
  }
  return paths;
}

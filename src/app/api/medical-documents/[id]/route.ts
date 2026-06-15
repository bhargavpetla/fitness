import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import { MEDICAL_DOCUMENTS_BUCKET } from "@/lib/medical-docs";

export const runtime = "nodejs";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const supabase = await createServerSupabase();
  const { data: doc, error: loadError } = await supabase
    .from("medical_documents")
    .select("storage_path")
    .eq("user_id", user.id)
    .eq("id", id)
    .single();

  if (loadError || !doc) {
    return NextResponse.json({ error: "Medical document not found." }, { status: 404 });
  }

  await supabase.storage.from(MEDICAL_DOCUMENTS_BUCKET).remove([doc.storage_path]);
  const { error: deleteError } = await supabase
    .from("medical_documents")
    .delete()
    .eq("user_id", user.id)
    .eq("id", id);

  if (deleteError) return NextResponse.json({ error: "Could not delete document." }, { status: 500 });
  return NextResponse.json({ ok: true });
}

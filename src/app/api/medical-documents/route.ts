import { NextResponse } from "next/server";
import { getUser, createServerSupabase } from "@/lib/supabase/server";
import {
  MAX_MEDICAL_DOC_TOTAL_BYTES,
  MAX_STORED_MEDICAL_DOCS,
  prepareMedicalDocumentFile,
  storeMedicalDocumentUploads,
} from "@/lib/medical-docs";

export const runtime = "nodejs";

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("medical_documents")
    .select("id,file_name,mime_type,size_bytes,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "Could not load medical documents." }, { status: 500 });
  return NextResponse.json({ documents: data ?? [] });
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createServerSupabase();
  const { data: existingDocs, count } = await supabase
    .from("medical_documents")
    .select("size_bytes", { count: "exact" })
    .eq("user_id", user.id);

  if ((count ?? 0) >= MAX_STORED_MEDICAL_DOCS) {
    return NextResponse.json(
      { error: `Keep up to ${MAX_STORED_MEDICAL_DOCS} saved medical documents.` },
      { status: 400 }
    );
  }

  let file: File | null = null;
  try {
    const form = await req.formData();
    file = form.get("file") as File | null;
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }

  if (!file || file.size === 0) {
    return NextResponse.json({ error: "Choose a PDF, DOCX, or TXT file." }, { status: 400 });
  }

  try {
    const upload = await prepareMedicalDocumentFile(file);
    const existingBytes = (existingDocs ?? []).reduce((sum, doc) => sum + Number(doc.size_bytes ?? 0), 0);
    if (existingBytes + upload.sizeBytes > MAX_MEDICAL_DOC_TOTAL_BYTES) {
      return NextResponse.json({ error: "Keep medical uploads under 3 MB total." }, { status: 400 });
    }
    await storeMedicalDocumentUploads(supabase, user.id, [upload]);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("medical-documents upload failed:", e);
    return NextResponse.json({ error: (e as Error).message || "Upload failed." }, { status: 400 });
  }
}

import { inflateRawSync } from "node:zlib";

export const MAX_MEDICAL_DOCS = 2;
export const MAX_STORED_MEDICAL_DOCS = 4;
export const MAX_MEDICAL_DOC_BYTES = 2 * 1024 * 1024;
export const MAX_MEDICAL_DOC_TOTAL_BYTES = 3 * 1024 * 1024;
export const MAX_MEDICAL_DOC_TEXT_CHARS = 12000;
export const MEDICAL_DOCUMENTS_BUCKET = "medical-documents";

export interface UploadedMedicalDocument {
  name: string;
  mime_type: string;
  data_url: string;
}

export type PreparedMedicalDocument =
  | { kind: "pdf"; name: string; base64: string }
  | { kind: "text"; name: string; text: string };

export interface PreparedMedicalDocumentUpload {
  name: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Buffer;
  textContent: string | null;
  modelDocument: PreparedMedicalDocument;
}

type SupabaseLike = {
  from: (table: string) => any;
  storage: {
    from: (bucket: string) => any;
  };
};

type StoredMedicalDocumentRow = {
  file_name: string;
  mime_type: string;
  storage_path: string;
  text_content: string | null;
};

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";
const TEXT_MIMES = new Set(["text/plain", "text/markdown", "text/csv"]);

export function prepareMedicalDocuments(docs: UploadedMedicalDocument[] = []): PreparedMedicalDocument[] {
  return prepareMedicalDocumentUploads(docs).map((doc) => doc.modelDocument);
}

export function prepareMedicalDocumentUploads(docs: UploadedMedicalDocument[] = []): PreparedMedicalDocumentUpload[] {
  if (docs.length > MAX_MEDICAL_DOCS) {
    throw new Error(`Upload up to ${MAX_MEDICAL_DOCS} medical documents.`);
  }

  let totalBytes = 0;
  return docs.map((doc) => {
    const parsed = parseDataUrl(doc.data_url);
    const mimeType = normalizeMime(doc.mime_type || parsed.mimeType, doc.name);
    const name = sanitizeDocName(doc.name);
    totalBytes += parsed.buffer.byteLength;

    if (parsed.buffer.byteLength > MAX_MEDICAL_DOC_BYTES) {
      throw new Error(`${name} is too large. Use files under 2 MB.`);
    }
    if (totalBytes > MAX_MEDICAL_DOC_TOTAL_BYTES) {
      throw new Error("Keep medical uploads under 3 MB total.");
    }

    if (mimeType === PDF_MIME) {
      return {
        name,
        mimeType,
        sizeBytes: parsed.buffer.byteLength,
        buffer: parsed.buffer,
        textContent: null,
        modelDocument: { kind: "pdf", name, base64: parsed.base64 },
      };
    }

    if (mimeType === DOCX_MIME) {
      const text = extractDocxText(parsed.buffer);
      if (!text) throw new Error(`Could not read text from ${name}.`);
      const textContent = truncateText(text);
      return {
        name,
        mimeType,
        sizeBytes: parsed.buffer.byteLength,
        buffer: parsed.buffer,
        textContent,
        modelDocument: { kind: "text", name, text: textContent },
      };
    }

    if (TEXT_MIMES.has(mimeType) || name.toLowerCase().endsWith(".txt")) {
      const text = parsed.buffer.toString("utf8").replace(/\u0000/g, "").trim();
      if (!text) throw new Error(`${name} did not contain readable text.`);
      const textContent = truncateText(text);
      return {
        name,
        mimeType: "text/plain",
        sizeBytes: parsed.buffer.byteLength,
        buffer: parsed.buffer,
        textContent,
        modelDocument: { kind: "text", name, text: textContent },
      };
    }

    throw new Error(`${name} is not supported. Upload PDF, DOCX, or TXT.`);
  });
}

export function prepareMedicalDocumentFile(file: File): Promise<PreparedMedicalDocumentUpload> {
  return file.arrayBuffer().then((arrayBuffer) => {
    const mimeType = file.type || inferMimeFromName(file.name);
    const dataUrl = `data:${mimeType};base64,${Buffer.from(arrayBuffer).toString("base64")}`;
    return prepareMedicalDocumentUploads([{ name: file.name, mime_type: mimeType, data_url: dataUrl }])[0];
  });
}

export async function storeMedicalDocumentUploads(
  supabase: SupabaseLike,
  userId: string,
  uploads: PreparedMedicalDocumentUpload[]
): Promise<void> {
  for (const upload of uploads) {
    const path = `${userId}/${Date.now()}-${crypto.randomUUID()}-${storageSafeName(upload.name)}`;
    const { error: uploadError } = await supabase.storage
      .from(MEDICAL_DOCUMENTS_BUCKET)
      .upload(path, upload.buffer, { contentType: upload.mimeType, upsert: false });
    if (uploadError) throw uploadError;

    const { error: insertError } = await supabase.from("medical_documents").insert({
      user_id: userId,
      file_name: upload.name,
      mime_type: upload.mimeType,
      size_bytes: upload.sizeBytes,
      storage_path: path,
      text_content: upload.textContent,
    });
    if (insertError) {
      await supabase.storage.from(MEDICAL_DOCUMENTS_BUCKET).remove([path]);
      throw insertError;
    }
  }
}

export async function loadStoredMedicalDocuments(
  supabase: SupabaseLike,
  userId: string
): Promise<PreparedMedicalDocument[]> {
  const { data, error } = await supabase
    .from("medical_documents")
    .select("file_name,mime_type,storage_path,text_content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MAX_STORED_MEDICAL_DOCS);

  if (error || !data) return [];

  const docs: PreparedMedicalDocument[] = [];
  for (const row of data as StoredMedicalDocumentRow[]) {
    if (row.text_content) {
      docs.push({ kind: "text", name: row.file_name, text: row.text_content });
      continue;
    }

    if (row.mime_type === PDF_MIME) {
      const { data: file } = await supabase.storage.from(MEDICAL_DOCUMENTS_BUCKET).download(row.storage_path);
      if (!file) continue;
      const bytes = Buffer.from(await file.arrayBuffer());
      docs.push({ kind: "pdf", name: row.file_name, base64: bytes.toString("base64") });
    }
  }

  return docs;
}

function inferMimeFromName(fileName: string): string {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".pdf")) return PDF_MIME;
  if (lowerName.endsWith(".docx")) return DOCX_MIME;
  if (lowerName.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string; buffer: Buffer } {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("Invalid medical document upload.");
  const base64 = match[2];
  return { mimeType: match[1], base64, buffer: Buffer.from(base64, "base64") };
}

function normalizeMime(mimeType: string, fileName: string): string {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".pdf")) return PDF_MIME;
  if (lowerName.endsWith(".docx")) return DOCX_MIME;
  if (lowerName.endsWith(".txt")) return "text/plain";
  return mimeType.toLowerCase();
}

function sanitizeDocName(name: string): string {
  const clean = name.replace(/[^\w .()-]/g, "").trim();
  return clean.slice(0, 120) || "medical-document";
}

function storageSafeName(name: string): string {
  return sanitizeDocName(name).replace(/\s+/g, "-");
}

function truncateText(text: string): string {
  const normalized = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= MAX_MEDICAL_DOC_TEXT_CHARS) return normalized;
  return `${normalized.slice(0, MAX_MEDICAL_DOC_TEXT_CHARS)}\n\n[Document truncated for onboarding context.]`;
}

function extractDocxText(buffer: Buffer): string {
  const entries = readZipEntries(buffer);
  const xmlBuffers = ["word/document.xml", "word/footnotes.xml", "word/endnotes.xml"]
    .map((name) => entries.get(name))
    .filter((entry): entry is Buffer => Boolean(entry));

  return xmlBuffers.map((xml) => extractTextFromWordXml(xml.toString("utf8"))).join("\n\n").trim();
}

function readZipEntries(buffer: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const fileName = buffer.subarray(offset + 46, offset + 46 + fileNameLength).toString("utf8");

    if (fileName.startsWith("word/") && fileName.endsWith(".xml")) {
      entries.set(fileName, readZipEntryData(buffer, localHeaderOffset, compressedSize, compressionMethod));
    }

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Invalid DOCX file.");
}

function readZipEntryData(
  buffer: Buffer,
  localHeaderOffset: number,
  compressedSize: number,
  compressionMethod: number
): Buffer {
  if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error("Invalid DOCX entry.");
  }

  const fileNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) return compressed;
  if (compressionMethod === 8) return inflateRawSync(compressed);
  throw new Error("Unsupported DOCX compression.");
}

function extractTextFromWordXml(xml: string): string {
  const normalizedXml = xml
    .replace(/<w:tab\/>/g, "<w:t>\t</w:t>")
    .replace(/<w:br\/>/g, "<w:t>\n</w:t>");
  const paragraphs = normalizedXml.split(/<\/w:p>/g);

  return paragraphs
    .map((paragraph) =>
      Array.from(paragraph.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
        .map((match) => decodeXml(match[1]))
        .join("")
        .trim()
    )
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXml(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return _;
  });
}

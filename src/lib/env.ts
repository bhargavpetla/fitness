// Centralised env access. Server-only secrets are read lazily so the client
// bundle never references them. Public values are inlined by Next at build time.

export const PUBLIC_ENV = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "",
};

export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export function hasSupabase(): boolean {
  return Boolean(PUBLIC_ENV.supabaseUrl && PUBLIC_ENV.supabaseAnonKey);
}

/** Server-only secrets. Throws if accessed without being set. */
export function serverEnv() {
  const get = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`Missing required env var: ${k}`);
    return v;
  };
  return {
    supabaseUrl: get("NEXT_PUBLIC_SUPABASE_URL"),
    supabaseAnonKey: get("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supabaseServiceRoleKey: get("SUPABASE_SERVICE_ROLE_KEY"),
    anthropicKey: get("ANTHROPIC_API_KEY"),
    geminiKey: get("GEMINI_API_KEY"),
    anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
    geminiFoodModel: process.env.GEMINI_FOOD_MODEL ?? "gemini-3.5-flash",
    geminiExerciseModel: process.env.GEMINI_EXERCISE_MODEL ?? "gemini-3.5-flash",
    geminiImageModel: process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image",
  };
}

import Anthropic from "@anthropic-ai/sdk";
import { serverEnv } from "@/lib/env";
import type { PreparedMedicalDocument } from "@/lib/medical-docs";
import type { BodyAnalysis } from "@/lib/types";

// ---- Claude Sonnet 4.6: body analysis + macro target generation ----

export interface BodyAnalysisInput {
  age: number | null;
  height_cm: number | null;
  weight_kg: number;
  sex: string | null;
  build_note: string | null;
  activity_level?: string | null; // sedentary | light | moderate | very
  daily_steps?: number | null;
  goal_type: string;
  goal_note?: string | null;
  // base64 data URLs (data:image/jpeg;base64,...) — front and optional side.
  photos?: string[];
  // Optional onboarding-only medical context. Not persisted by the app.
  medical_docs?: PreparedMedicalDocument[];
  // check-in extras
  checkin?: {
    prev_weight_kg: number | null;
    avg_daily_calories: number | null;
    avg_daily_protein_g: number | null;
    current_target: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
    days: number;
  };
}

const GUARDRAILS = `
GUARDRAILS (non-negotiable):
- Body fat is an ESTIMATE from limited inputs, presented as a RANGE (e.g. "14-17%"), never a single false-precision number, never framed as a medical/clinical reading.
- Protein target stays in a sane range, roughly 1.6 to 2.2 g per kg bodyweight.
- Never recommend an aggressive caloric deficit. Never suggest calories below a safe floor (about 1500 for most adults; scale up for larger/active people).
- Macros must sum sensibly to calories (protein 4 kcal/g, carbs 4 kcal/g, fat 9 kcal/g) within ~5%.
- If uploaded medical documents mention conditions, medications, allergies, lab results, injuries, pregnancy, eating-disorder history, kidney/liver/cardiac/metabolic issues, or physician instructions, use them only as safety context for conservative fitness/nutrition planning.
- Do not diagnose, interpret labs as medical advice, change medication guidance, or override a clinician. If the documents imply medical risk, note that the user should confirm the plan with their clinician in the rationale.
- Be warm and concise. This is motivation and trend tracking, not diagnosis.
`;

function buildSchemaInstruction(isCheckin: boolean): string {
  return `Return STRICT JSON only, no prose, matching exactly:
{
  "body_fat_estimate": "string range like 14-17%",
  "confidence_note": "one short line on confidence",
  "body_type_read": "one short sentence",
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fat_g": number,
  "goal_type": "recomp" | "bulk" | "cut" | "maintain",
  "activity_level": "sedentary" | "light" | "moderate" | "very",
  ${isCheckin ? '"assessment": "is the plan working for the stated goal? one or two sentences",' : ""}
  "rationale": "one or two sentences explaining the macro choice, noting how activity affected calories"
}`;
}

export async function analyzeBody(input: BodyAnalysisInput): Promise<BodyAnalysis> {
  const env = serverEnv();
  const client = new Anthropic({ apiKey: env.anthropicKey });
  const isCheckin = Boolean(input.checkin);

  const facts = [
    `Age: ${input.age ?? "unknown"}`,
    `Height: ${input.height_cm ? input.height_cm + " cm" : "unknown"}`,
    `Current weight: ${input.weight_kg} kg`,
    `Sex/build: ${input.sex ?? "unspecified"}`,
    `Build note: ${input.build_note ?? "none"}`,
    `Activity level: ${input.activity_level ?? "moderate (assume)"}`,
    `Typical daily steps: ${input.daily_steps ?? "unknown"}`,
    `Goal: ${input.goal_type}${input.goal_note ? " — " + input.goal_note : ""}`,
    `IMPORTANT: scale total daily calories to the activity level and step count — a more active person needs more calories. Reflect this in the calorie target.`,
  ];
  if (input.checkin) {
    const c = input.checkin;
    facts.push(
      `--- WEEKLY CHECK-IN CONTEXT ---`,
      `Days elapsed: ${c.days}`,
      `Previous weight: ${c.prev_weight_kg ?? "unknown"} kg (so trend = ${
        c.prev_weight_kg != null ? (input.weight_kg - c.prev_weight_kg).toFixed(1) + " kg" : "unknown"
      })`,
      `Avg daily intake this period: ${c.avg_daily_calories ?? "?"} kcal, ${c.avg_daily_protein_g ?? "?"} g protein`,
      `Current target: ${c.current_target.calories} kcal, ${c.current_target.protein_g}g P, ${c.current_target.carbs_g}g C, ${c.current_target.fat_g}g F`,
      `Judge whether progress matches the goal and propose adjusted macros only if warranted.`
    );
  }

  const content: Anthropic.MessageParam["content"] = [];
  for (const photo of input.photos ?? []) {
    const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(photo);
    if (!match) continue;
    content.push({
      type: "image",
      source: { type: "base64", media_type: match[1] as never, data: match[2] },
    });
  }
  for (const doc of input.medical_docs ?? []) {
    const context =
      "Medical background uploaded during first-time onboarding. Use this only for safety constraints, contraindications, allergies, medications, conditions, injuries, and nutrition/exercise considerations. Do not provide diagnosis or medication advice.";
    content.push({
      type: "document",
      title: doc.name,
      context,
      source:
        doc.kind === "pdf"
          ? { type: "base64", media_type: "application/pdf", data: doc.base64 }
          : { type: "text", media_type: "text/plain", data: doc.text },
    });
  }
  content.push({
    type: "text",
    text: `${isCheckin ? "Re-assess and propose macros." : "Analyze body and generate daily macro targets."}\n\n${facts.join(
      "\n"
    )}\n\n${buildSchemaInstruction(isCheckin)}`,
  });

  const msg = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 1024,
    system:
      "You are a careful, encouraging fitness coach and nutrition planner who reasons from photos and basic metrics. " +
      GUARDRAILS,
    messages: [{ role: "user", content }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  return parseBodyJson(text);
}

function parseBodyJson(text: string): BodyAnalysis {
  const jsonStr = extractJson(text);
  const raw = JSON.parse(jsonStr);
  return {
    body_fat_estimate: String(raw.body_fat_estimate ?? "unknown"),
    confidence_note: String(raw.confidence_note ?? "Estimate from limited inputs."),
    body_type_read: String(raw.body_type_read ?? ""),
    calories: Number(raw.calories),
    protein_g: Number(raw.protein_g),
    carbs_g: Number(raw.carbs_g),
    fat_g: Number(raw.fat_g),
    goal_type: raw.goal_type ?? "maintain",
    activity_level: raw.activity_level ?? undefined,
    assessment: raw.assessment ? String(raw.assessment) : undefined,
    rationale: String(raw.rationale ?? ""),
  };
}

// Grounded "where am I / what to adjust" read over a week or month of intake.
export interface ProgressInput {
  period: "week" | "month";
  goal: { calories: number; protein_g: number; carbs_g: number; fat_g: number; goal_type: string };
  avg: { calories: number; protein_g: number; carbs_g: number; fat_g: number };
  days_logged: number;
  total_days: number;
  weight_change_kg: number | null;
}

export async function progressSummary(input: ProgressInput): Promise<string> {
  const env = serverEnv();
  const client = new Anthropic({ apiKey: env.anthropicKey });

  const facts = [
    `Period: this ${input.period}`,
    `Goal type: ${input.goal.goal_type}`,
    `Daily target: ${input.goal.calories} cal, ${input.goal.protein_g}g protein, ${input.goal.carbs_g}g carbs, ${input.goal.fat_g}g fat`,
    `Average daily intake: ${input.avg.calories} cal, ${input.avg.protein_g}g protein, ${input.avg.carbs_g}g carbs, ${input.avg.fat_g}g fat`,
    `Days logged: ${input.days_logged} of ${input.total_days}`,
    `Weight change over period: ${input.weight_change_kg != null ? input.weight_change_kg.toFixed(1) + " kg" : "unknown"}`,
  ].join("\n");

  const msg = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 400,
    system:
      "You are a concise, encouraging fitness coach. Given a week or month of nutrition data vs a goal, tell the user " +
      "in 3-4 short bullet lines: (1) where they are relative to the goal, (2) the single most useful adjustment, " +
      "(3) one thing going well. Be specific with numbers. No medical claims, no shaming, no generic filler.",
    messages: [{ role: "user", content: facts }],
  });

  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

// Pulls a JSON object out of a model reply, tolerating code fences and any
// surrounding prose (e.g. Google Search grounding text appended around the JSON,
// which can itself contain `{` or `}` and break a naive first-brace/last-brace
// slice). Scans for the first balanced `{...}` object, respecting string
// literals and escapes so braces inside strings don't throw off the depth count.
export function extractJson(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced ? fenced[1] : text;

  const start = body.indexOf("{");
  if (start === -1) throw new Error("No JSON found in model response");

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  throw new Error("No complete JSON object found in model response");
}

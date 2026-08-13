import Anthropic from '@anthropic-ai/sdk';
import { DISTRACTORS, SceneSpec, fallbackScene } from '@/lib/ai/scene-schema';

/**
 * The whole LLM surface of MemeBack: one call per answer to turn it into a
 * storyboard, and one call per question to build guess options.
 *
 * Everything here is failure-tolerant on purpose — a classroom of 30 students
 * cannot be held hostage by one slow request, and the app must stay fully
 * playable with no API key at all.
 */

const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';
const TIMEOUT_MS = 12_000;
const MAX_PARALLEL = 5;

let client: Anthropic | null = null;
function anthropic(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  client ??= new Anthropic({ apiKey: key, maxRetries: 0 });
  return client;
}

export function llmAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// ---------------------------------------------------------------------------
// bounded concurrency queue
// ---------------------------------------------------------------------------

type Job<T> = { run: () => Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };

const queue: Job<any>[] = [];
let active = 0;

function pump() {
  while (active < MAX_PARALLEL && queue.length) {
    const job = queue.shift()!;
    active++;
    job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        active--;
        pump();
      });
  }
}

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ run, resolve, reject });
    pump();
  });
}

// ---------------------------------------------------------------------------
// prompts
// ---------------------------------------------------------------------------

const STORYBOARD_SYSTEM = `You convert a student's free-text answer into a storyboard for a short meme animation.

RULES
1. Never invent content the student did not imply. You are re-encoding their idea, not answering the question.
2. Judge the answer only against TARGET_CONCEPT. A creative but scientifically wrong answer is "misconception", not "off_topic".
3. "off_topic" is only for blank, joke-only, or unrelated answers.
4. Every beat's \`clip\` MUST come from the allowed clip list. If the student's verb is not in the list, choose the closest one. Never invent a clip name.
5. \`caption\` is the meme punchline in Thai. It must NOT name the target concept — the class has to guess it.
6. \`concept_note\` explains to the student in Thai whether they got it and why.
7. Beats are chronological. Total duration must be between 1500ms and 6000ms.
8. Output raw JSON only. No markdown fences, no prose.

ALLOWED CLIPS: idle, walk, run, jump, kick, punch, push, pull, collide,
knockback, fall, bounce, shake, spin, throw, catch, float, sink, pop,
point, think_bubble, sweat, celebrate

SHAPE
{"understood":bool,"verdict":"correct|partial|misconception|off_topic","concept_note":str<=160,
"misconception":str|null,"teaching_point":str<=200,
"scene":{"setting":"classroom|street|water|space|kitchen|field|void",
"meme_format":"impact_caption|two_panel|reaction_zoom|before_after",
"actors":[{"id":"A","label":str<=24,"sprite":"person_a|person_b|cat|ball|boat|box|car|rocket","x":0..1}],
"beats":[{"actor":"A","clip":"<allowed clip>","target":"B"|null,"duration_ms":200..2000}],
"caption":str<=70}}

Actors: 1-3. Beats: 1-6. \`x\` is the horizontal start position, 0 = far left, 1 = far right;
place actors apart from each other. Set \`target\` when one actor acts on another.`;

const DISTRACTOR_SYSTEM = `You write multiple-choice distractors for a classroom guessing game.

Given TARGET_CONCEPT and SUBJECT, return exactly 3 *other* concepts from the same subject
that students commonly confuse with the target. They must be plausible enough that guessing
is not trivial, and must never be paraphrases of the target itself.

Write them in the same language as TARGET_CONCEPT's classroom uses (Thai unless told otherwise).
Output raw JSON only: {"distractors":["...","...","..."]}`;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    // the model sometimes wraps JSON in a sentence — grab the outermost object
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

async function callModel(system: string, user: string, maxTokens: number): Promise<unknown> {
  const ai = anthropic();
  if (!ai) throw new Error('no-api-key');

  const res = await ai.messages.create(
    {
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    },
    { timeout: TIMEOUT_MS },
  );

  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return extractJson(text);
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

export type AnalyzeInput = {
  targetConcept: string;
  conceptHint?: string | null;
  subject: string;
  studentAnswer: string;
};

export type AnalyzeResult = { spec: SceneSpec; fromFallback: boolean };

/**
 * One storyboard per answer. Validates with Zod, retries once on a schema miss
 * or timeout, then falls back — never throws.
 */
export function analyzeAnswer(input: AnalyzeInput): Promise<AnalyzeResult> {
  return enqueue(async () => {
    const user = [
      `TARGET_CONCEPT: ${input.targetConcept}`,
      `CONCEPT_HINT: ${input.conceptHint?.trim() || '(none)'}`,
      `SUBJECT: ${input.subject}`,
      `STUDENT_ANSWER: ${input.studentAnswer}`,
    ].join('\n');

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const raw = await callModel(STORYBOARD_SYSTEM, user, 1400);
        const parsed = SceneSpec.safeParse(raw);
        if (parsed.success) return { spec: parsed.data, fromFallback: false };
        if (attempt === 0) {
          console.warn('[ai] storyboard failed validation, retrying:', parsed.error.issues[0]?.message);
        } else {
          console.warn('[ai] storyboard failed validation twice, using fallback');
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'no-api-key') break;
        console.warn(`[ai] storyboard attempt ${attempt + 1} failed:`, msg);
      }
    }

    return { spec: fallbackScene(input.studentAnswer), fromFallback: true };
  });
}

const GENERIC_DISTRACTORS: Record<string, string[]> = {
  science: ['กฎการอนุรักษ์พลังงาน', 'แรงเสียดทาน', 'ความเฉื่อย'],
  math: ['ทฤษฎีบทพีทาโกรัส', 'สมบัติการสลับที่', 'อัตราส่วนตรีโกณมิติ'],
  social: ['อุปสงค์และอุปทาน', 'การแบ่งแยกอำนาจ', 'การปฏิวัติอุตสาหกรรม'],
};

/** Three near-miss concepts, cached on the question. Never throws. */
export async function generateDistractors(
  targetConcept: string,
  subject: string,
): Promise<string[]> {
  const generic = (GENERIC_DISTRACTORS[subject] ?? GENERIC_DISTRACTORS.science)!;
  if (!llmAvailable()) return generic;

  try {
    return await enqueue(async () => {
      const raw = await callModel(
        DISTRACTOR_SYSTEM,
        `TARGET_CONCEPT: ${targetConcept}\nSUBJECT: ${subject}`,
        400,
      );
      const list = DISTRACTORS.safeParse((raw as { distractors?: unknown })?.distractors);
      if (!list.success) return generic;
      // guard against the model just restating the target
      const norm = (s: string) => s.trim().toLowerCase();
      const clean = list.data.filter((d) => norm(d) !== norm(targetConcept));
      return clean.length === 3 ? clean : generic;
    });
  } catch (err) {
    console.warn('[ai] distractor generation failed:', err instanceof Error ? err.message : err);
    return generic;
  }
}

/**
 * Thin client for OpenAI's Sora video-generation API. Same shape as
 * `src/server/kling.ts`. Only caller: `scripts/generate-backgrounds.ts`,
 * offline, never touches the request path. Per-meme video generation
 * (formerly src/server/meme-upgrade.ts) was replaced by a Giphy search
 * (src/server/giphy.ts) — see that file for why.
 */

const BASE = 'https://api.openai.com/v1/videos';
const MODEL = process.env.SORA_MODEL ?? 'sora-2';
const POLL_INTERVAL_MS = 10_000;
const POLL_TIMEOUT_MS = 10 * 60_000;

function apiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY is not set');
  return key;
}

function headers(): Record<string, string> {
  return { Authorization: `Bearer ${apiKey()}` };
}

export function soraAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

type CreateResponse = {
  id?: string;
  status?: 'queued' | 'in_progress' | 'completed' | 'failed';
  error?: { message?: string };
};

export type GenerateVideoInput = {
  prompt: string;
  size?: '1280x720' | '1920x1080' | '1080x1920';
  /** Sora only accepts fixed durations. */
  seconds?: '8' | '16' | '20';
};

/**
 * Sora's moderation check runs against the *rendered* clip, not just the
 * prompt — the same wording can pass on one attempt and get blocked on the
 * next. One retry absorbs that flakiness instead of forcing a full re-run of
 * `generate-backgrounds.ts` (and a second billed attempt) by hand.
 */
export async function generateVideo(input: GenerateVideoInput): Promise<Buffer> {
  try {
    return await submitAndPoll(input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('moderation')) throw err;
    return submitAndPoll(input);
  }
}

async function submitAndPoll(input: GenerateVideoInput): Promise<Buffer> {
  const submitRes = await fetch(BASE, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: input.prompt,
      size: input.size ?? '1280x720',
      seconds: input.seconds ?? '8',
    }),
  });
  if (!submitRes.ok) {
    throw new Error(`sora submit failed: ${submitRes.status} ${await submitRes.text()}`);
  }
  const submitted = (await submitRes.json()) as CreateResponse;
  const id = submitted.id;
  if (!id) throw new Error(`sora submit returned no id: ${JSON.stringify(submitted)}`);
  console.error(`[sora] task_id: ${id} (save this — the job is billed once submitted; a poll` +
    ` hiccup does not need a re-submit)`);

  return pollUntilDone(id);
}

/**
 * Separated from submission so a task that already started generating (and
 * is being billed for) doesn't need a full, second-paid re-submit just
 * because one status check hit a transient network/5xx error.
 */
const MAX_POLL_ERRORS = 5;

async function pollUntilDone(id: string): Promise<Buffer> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let consecutiveErrors = 0;

  while (Date.now() < deadline) {
    const pollRes = await fetch(`${BASE}/${id}`, { headers: headers() });
    if (!pollRes.ok) {
      consecutiveErrors++;
      if (pollRes.status >= 500 && consecutiveErrors < MAX_POLL_ERRORS) {
        console.error(`[sora] poll got ${pollRes.status}, retrying (${consecutiveErrors}/${MAX_POLL_ERRORS})...`);
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        continue;
      }
      throw new Error(`sora poll failed: ${pollRes.status} ${await pollRes.text()}`);
    }
    consecutiveErrors = 0;
    const polled = (await pollRes.json()) as CreateResponse;

    if (polled.status === 'completed') {
      const contentRes = await fetch(`${BASE}/${id}/content?variant=video`, { headers: headers() });
      if (!contentRes.ok) {
        throw new Error(`sora content download failed: ${contentRes.status} ${await contentRes.text()}`);
      }
      return Buffer.from(await contentRes.arrayBuffer());
    }
    if (polled.status === 'failed') {
      throw new Error(`sora task failed: ${polled.error?.message ?? 'unknown error'}`);
    }

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(`sora task ${id} did not finish within ${POLL_TIMEOUT_MS}ms`);
}

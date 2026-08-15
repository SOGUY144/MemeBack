/**
 * Thin client for Kling AI's image-generation API. This is deliberately kept
 * out of the request path — see `scripts/generate-backgrounds.ts`, the only
 * caller. It renders one static background image per SETTING, offline,
 * and the browser renderer (`src/lib/meme/renderer.ts`) picks the file up
 * from `public/backgrounds/` if present.
 *
 * Why offline instead of per-answer: MemeBack's whole meme pipeline is
 * sprite-based specifically to hit a <5s budget per submission (see the
 * project spec's non-goals). A generative image call takes several seconds
 * and costs real money per call — fine once per SETTING (7 total, ever),
 * not once per student answer in a class of 30.
 */

const BASE = process.env.KLING_API_BASE ?? 'https://api-singapore.klingai.com';
const MODEL = process.env.KLING_MODEL ?? 'kling-v1';
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 120_000;

function apiKey(): string {
  const key = process.env.KLING_API_KEY;
  if (!key) throw new Error('KLING_API_KEY is not set');
  return key;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey()}`,
    'Content-Type': 'application/json',
  };
}

type SubmitResponse = {
  data?: { task_id?: string };
  code?: number;
  message?: string;
};

type PollResponse = {
  data?: {
    task_status?: 'submitted' | 'processing' | 'succeed' | 'failed';
    task_status_msg?: string;
    task_result?: { images?: { url: string }[] };
  };
  code?: number;
  message?: string;
};

export type GenerateImageInput = {
  prompt: string;
  negativePrompt?: string;
  /** Matches the 480x270 meme canvas closely enough; Kling only offers fixed ratios. */
  aspectRatio?: '16:9' | '1:1' | '4:3' | '3:2' | '2:3' | '3:4' | '9:16' | '21:9';
};

/** Submits a text-to-image job and polls until it succeeds, fails, or times out. */
export async function generateImage(input: GenerateImageInput): Promise<Buffer> {
  const submitRes = await fetch(`${BASE}/v1/images/generations`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      model_name: MODEL,
      prompt: input.prompt,
      negative_prompt: input.negativePrompt,
      aspect_ratio: input.aspectRatio ?? '16:9',
      num_images: 1,
    }),
  });
  if (!submitRes.ok) {
    throw new Error(`kling submit failed: ${submitRes.status} ${await submitRes.text()}`);
  }
  const submitted = (await submitRes.json()) as SubmitResponse;
  const taskId = submitted.data?.task_id;
  if (!taskId) throw new Error(`kling submit returned no task_id: ${JSON.stringify(submitted)}`);

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const pollRes = await fetch(`${BASE}/v1/images/generations/${taskId}`, {
      headers: headers(),
    });
    if (!pollRes.ok) {
      throw new Error(`kling poll failed: ${pollRes.status} ${await pollRes.text()}`);
    }
    const polled = (await pollRes.json()) as PollResponse;
    const status = polled.data?.task_status;

    if (status === 'succeed') {
      const url = polled.data?.task_result?.images?.[0]?.url;
      if (!url) throw new Error('kling task succeeded but returned no image url');
      const imgRes = await fetch(url);
      if (!imgRes.ok) throw new Error(`failed to download generated image: ${imgRes.status}`);
      return Buffer.from(await imgRes.arrayBuffer());
    }
    if (status === 'failed') {
      throw new Error(`kling task failed: ${polled.data?.task_status_msg ?? 'unknown error'}`);
    }
    // 'submitted' | 'processing' → keep polling
  }

  throw new Error(`kling task ${taskId} did not finish within ${POLL_TIMEOUT_MS}ms`);
}

import { rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, describe, expect, it } from 'vitest';
import { buildPrompt, compositeDialogue, overlayFontSize } from '@/server/image-gen';
import type { SceneSpec } from '@/lib/ai/scene-schema';

const MEME_DIR = path.join(process.cwd(), 'public', 'memes');
const testFiles = [
  'test-empty-ai.png',
  'test-stress-ai.png',
  'test-special-chars-ai.png',
  'test-newline-ai.png',
];

afterAll(async () => {
  await Promise.all(testFiles.map((f) => rm(path.join(MEME_DIR, f), { force: true })));
});

/**
 * No network calls anywhere in this file — buildPrompt is a pure string
 * builder, and compositeDialogue only ever touches local sharp/fs. The image
 * itself (gpt-image-1) is exercised manually against the live API, never
 * from an automated test — see server/socket.ts's teacher:generate-ai-meme
 * for where that boundary actually is.
 */

function spec(overrides: Partial<SceneSpec> = {}): SceneSpec {
  return {
    understood: true,
    verdict: 'correct',
    concept_note: '',
    misconception: null,
    teaching_point: '',
    matched_meme: null,
    dialogue: [],
    scene: {
      setting: 'street',
      meme_format: 'impact_caption',
      actors: [{ id: 'A', label: 'สมชาย', sprite: 'person_a', x: 0.5 }],
      beats: [{ actor: 'A', clip: 'kick', target: null, duration_ms: 500 }],
      caption: 'ป้ายกำกับลับ CAPTION_MARKER',
    },
    ...overrides,
  };
}

describe('buildPrompt — PII', () => {
  it('never includes a free-text actor label (the fallback/unmatched path)', () => {
    const prompt = buildPrompt(spec());
    expect(prompt).not.toContain('สมชาย');
  });

  it('never includes scene.caption either — also LLM-authored free text', () => {
    const prompt = buildPrompt(spec());
    expect(prompt).not.toContain('CAPTION_MARKER');
  });

  it('describes the fallback subject generically from the closed sprite enum instead', () => {
    const prompt = buildPrompt(spec());
    expect(prompt).toContain('a person');
  });

  it('the matched-character path also never includes the actor label', () => {
    const prompt = buildPrompt(spec({ matched_meme: 'tralalero_tralala' }));
    expect(prompt).not.toContain('สมชาย');
    expect(prompt).toContain('shark');
  });
});

describe('buildPrompt — copyright posture', () => {
  it('matched-character prompts carry the original-reinterpretation instruction', () => {
    const prompt = buildPrompt(spec({ matched_meme: 'tralalero_tralala' }));
    expect(prompt).toMatch(/original artistic reinterpretation/i);
    expect(prompt).toMatch(/do not replicate any specific existing artwork/i);
  });

  it('never names a real brand in a matched-character prompt', () => {
    const prompt = buildPrompt(spec({ matched_meme: 'tralalero_tralala' }));
    expect(prompt.toLowerCase()).not.toContain('nike');
  });

  it('falls back to a generic description for an unmatched answer', () => {
    const prompt = buildPrompt(spec({ matched_meme: null }));
    expect(prompt).toContain('Subject:');
    expect(prompt).not.toMatch(/original artistic reinterpretation/i);
  });
});

describe('overlayFontSize', () => {
  it('stays at the cap for short text', () => {
    expect(overlayFontSize('สั้น', 900)).toBe(30);
  });

  it('shrinks as text gets longer', () => {
    const short = overlayFontSize('สิบตัวอักษรพอดี', 900);
    const long = overlayFontSize('ก'.repeat(80), 900);
    expect(long).toBeLessThan(short);
  });

  it('never goes below the readability floor even for extreme text', () => {
    expect(overlayFontSize('ก'.repeat(500), 900)).toBeGreaterThanOrEqual(16);
  });

  it('treats empty text as the cap (nothing to overflow)', () => {
    expect(overlayFontSize('', 900)).toBe(30);
  });
});

describe('compositeDialogue — overlay rendering', () => {
  async function tinyBase(): Promise<Buffer> {
    return sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#4d80c0' } })
      .png()
      .toBuffer();
  }

  it('renders with no dialogue at all (still a valid, same-size image)', async () => {
    const base = await tinyBase();
    const url = await compositeDialogue(base, [], 'test-empty');
    expect(url).toBe('/memes/test-empty-ai.png');
  });

  it('handles the maximum-length dialogue (4 lines, 20+60 chars each) without throwing', async () => {
    const base = await tinyBase();
    const longSpeaker = 'ตัวละครที่มีชื่อยาวมากจริงๆ';
    const longLine =
      'นี่คือประโยคภาษาไทยที่ยาวมากจนอาจจะล้นออกนอกกรอบได้ถ้าไม่มีการป้องกันไว้ก่อน';
    const url = await compositeDialogue(
      base,
      [
        { speaker: longSpeaker, line: longLine },
        { speaker: longSpeaker, line: longLine },
        { speaker: longSpeaker, line: longLine },
        { speaker: longSpeaker, line: longLine },
      ],
      'test-stress',
    );
    expect(url).toBe('/memes/test-stress-ai.png');
  });

  it('does not break on XML-special characters in the dialogue', async () => {
    const base = await tinyBase();
    const url = await compositeDialogue(
      base,
      [{ speaker: 'A&B<C>"D', line: `'quoted' & <tagged>` }],
      'test-special-chars',
    );
    expect(url).toBe('/memes/test-special-chars-ai.png');
  });

  it('collapses an embedded newline/tab instead of breaking the SVG', async () => {
    const base = await tinyBase();
    const url = await compositeDialogue(
      base,
      [{ speaker: 'A', line: 'line one\nline two\ttabbed' }],
      'test-newline',
    );
    expect(url).toBe('/memes/test-newline-ai.png');
  });
});

import { describe, expect, it } from 'vitest';
import { PHASES, canTransition, type Phase } from '@/lib/realtime/events';

/**
 * The phase machine decides what the teacher's one button does and, more
 * importantly, what the server will refuse. The expected edges are spelled out
 * here by hand rather than derived from PHASE_TRANSITIONS — a test that reads
 * the same table it is checking would pass no matter what the table said.
 */
const ALLOWED: ReadonlyArray<readonly [Phase, Phase]> = [
  ['LOBBY', 'ANSWERING'],
  ['ANSWERING', 'GENERATING'],
  ['GENERATING', 'PERSONAL_REVEAL'],
  ['PERSONAL_REVEAL', 'CLASS_GUESS'],
  ['PERSONAL_REVEAL', 'SCOREBOARD'],
  ['CLASS_GUESS', 'REVEAL'],
  ['REVEAL', 'CLASS_GUESS'],
  ['REVEAL', 'ANSWERING'],
  ['REVEAL', 'SCOREBOARD'],
  ['SCOREBOARD', 'ANSWERING'],
  ['SCOREBOARD', 'LOBBY'],
];

const isAllowed = (from: Phase, to: Phase) =>
  ALLOWED.some(([f, t]) => f === from && t === to);

describe('canTransition', () => {
  it.each(ALLOWED)('allows %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('rejects every edge not on the list', () => {
    const unexpected: string[] = [];
    for (const from of PHASES) {
      for (const to of PHASES) {
        if (canTransition(from, to) !== isAllowed(from, to)) unexpected.push(`${from} → ${to}`);
      }
    }
    expect(unexpected).toEqual([]);
  });

  it('never lets a phase re-enter itself', () => {
    for (const phase of PHASES) expect(canTransition(phase, phase)).toBe(false);
  });

  it('refuses to skip the AI step between answering and the personal reveal', () => {
    expect(canTransition('ANSWERING', 'PERSONAL_REVEAL')).toBe(false);
    expect(canTransition('ANSWERING', 'CLASS_GUESS')).toBe(false);
  });

  it('refuses to run the class guess before anyone has seen their own meme', () => {
    expect(canTransition('GENERATING', 'CLASS_GUESS')).toBe(false);
  });

  it('cannot walk backwards into an earlier phase of the same round', () => {
    expect(canTransition('GENERATING', 'ANSWERING')).toBe(false);
    expect(canTransition('CLASS_GUESS', 'PERSONAL_REVEAL')).toBe(false);
    expect(canTransition('PERSONAL_REVEAL', 'GENERATING')).toBe(false);
  });

  it('lets the teacher loop back for another question, but only from the two end phases', () => {
    expect(canTransition('REVEAL', 'ANSWERING')).toBe(true);
    expect(canTransition('SCOREBOARD', 'ANSWERING')).toBe(true);
    expect(canTransition('CLASS_GUESS', 'ANSWERING')).toBe(false);
    expect(canTransition('PERSONAL_REVEAL', 'ANSWERING')).toBe(false);
  });

  it('leaves every phase reachable from LOBBY by some path', () => {
    const seen = new Set<Phase>(['LOBBY']);
    const queue: Phase[] = ['LOBBY'];
    while (queue.length) {
      const from = queue.shift()!;
      for (const to of PHASES) {
        if (canTransition(from, to) && !seen.has(to)) {
          seen.add(to);
          queue.push(to);
        }
      }
    }
    expect([...PHASES].filter((p) => !seen.has(p))).toEqual([]);
  });
});

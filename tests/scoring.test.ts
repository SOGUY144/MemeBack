import { describe, expect, it } from 'vitest';
import { AUTHOR_BONUS, authorEarnedBonus, guessPoints, verdictPoints } from '@/server/scoring';

describe('guessPoints', () => {
  it('starts at 100 and drops 2 per second', () => {
    expect(guessPoints(0)).toBe(100);
    expect(guessPoints(1_000)).toBe(98);
    expect(guessPoints(10_000)).toBe(80);
  });

  it('counts whole seconds only', () => {
    expect(guessPoints(1_999)).toBe(98);
    expect(guessPoints(2_000)).toBe(96);
  });

  it('never falls below 40', () => {
    expect(guessPoints(30_000)).toBe(40);
    expect(guessPoints(120_000)).toBe(40);
  });

  it('ignores a clock that runs backwards', () => {
    expect(guessPoints(-5_000)).toBe(100);
  });
});

describe('authorEarnedBonus', () => {
  it('pays at exactly half the room', () => {
    expect(authorEarnedBonus(2, 4)).toBe(true);
    expect(authorEarnedBonus(3, 4)).toBe(true);
  });

  it('does not pay below half', () => {
    expect(authorEarnedBonus(1, 4)).toBe(false);
  });

  it('does not pay when nobody voted', () => {
    expect(authorEarnedBonus(0, 0)).toBe(false);
  });

  it('is worth 150', () => {
    expect(AUTHOR_BONUS).toBe(150);
  });
});

describe('verdictPoints', () => {
  it('follows the spec for correct and misconception', () => {
    expect(verdictPoints('correct')).toBe(50);
    expect(verdictPoints('misconception')).toBe(20);
  });

  it('never pays zero for an answer that was actually written', () => {
    for (const v of ['correct', 'partial', 'misconception', 'off_topic'] as const) {
      expect(verdictPoints(v)).toBeGreaterThan(0);
    }
  });

  it('ranks effort in the right order', () => {
    expect(verdictPoints('correct')).toBeGreaterThan(verdictPoints('partial'));
    expect(verdictPoints('partial')).toBeGreaterThan(verdictPoints('misconception'));
    expect(verdictPoints('misconception')).toBeGreaterThan(verdictPoints('off_topic'));
  });

  it('pays nothing for an answer that has not been judged yet', () => {
    expect(verdictPoints(null)).toBe(0);
  });

  it('re-scoring an edited answer is a difference, not a second payout', () => {
    // what the server does when an answer is re-analysed
    const award = (next: Parameters<typeof verdictPoints>[0], prev: Parameters<typeof verdictPoints>[0]) =>
      verdictPoints(next) - verdictPoints(prev);

    expect(award('correct', null)).toBe(50);
    expect(award('correct', 'correct')).toBe(0);
    expect(award('correct', 'misconception')).toBe(30);
    expect(award('off_topic', 'correct')).toBe(-45);
  });
});

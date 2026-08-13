import type { Verdict } from '@/lib/meme/vocab';

/** Correct guess: 100 pts, minus 2 pts per second elapsed, floor 40. */
export function guessPoints(elapsedMs: number): number {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return Math.max(40, 100 - 2 * seconds);
}

export const AUTHOR_BONUS = 150;

/** The author scores when at least half the voters read their meme correctly. */
export function authorEarnedBonus(correctVotes: number, totalVotes: number): boolean {
  return totalVotes > 0 && correctVotes / totalVotes >= 0.5;
}

/**
 * Points for your own answer. The spec fixes `correct` (50) and `misconception`
 * (20); `partial` and `off_topic` are filled in here on the same principle —
 * effort is never worth zero, but a blank answer is worth least.
 */
export function verdictPoints(verdict: Verdict | null): number {
  switch (verdict) {
    case 'correct':
      return 50;
    case 'partial':
      return 35;
    case 'misconception':
      return 20;
    case 'off_topic':
      return 5;
    default:
      return 0;
  }
}

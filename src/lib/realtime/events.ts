import type { Verdict } from '@/lib/meme/vocab';
import type { Scene } from '@/lib/ai/scene-schema';

export const PHASES = [
  'LOBBY',
  'ANSWERING',
  'GENERATING',
  'PERSONAL_REVEAL',
  'CLASS_GUESS',
  'REVEAL',
  'SCOREBOARD',
] as const;

export type Phase = (typeof PHASES)[number];

/** The teacher client drives the room; the server still checks every hop. */
export const PHASE_TRANSITIONS: Record<Phase, Phase[]> = {
  LOBBY: ['ANSWERING'],
  ANSWERING: ['GENERATING'],
  GENERATING: ['PERSONAL_REVEAL'],
  PERSONAL_REVEAL: ['CLASS_GUESS', 'SCOREBOARD'],
  CLASS_GUESS: ['REVEAL'],
  REVEAL: ['CLASS_GUESS', 'ANSWERING', 'SCOREBOARD'],
  SCOREBOARD: ['ANSWERING', 'LOBBY'],
};

export function canTransition(from: Phase, to: Phase): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}

export type PlayerView = { id: string; nickname: string; score: number; online: boolean };

export type QuestionView = {
  id: string;
  prompt: string;
  subject: string;
  /** Never includes targetConcept — students must not see the answer. */
  choicesReady: boolean;
};

export type RoomState = {
  code: string;
  phase: Phase;
  players: PlayerView[];
  question: QuestionView | null;
  answeredCount: number;
  playerCount: number;
};

export type MemeStage = 'analyzing' | 'composing' | 'encoding';

export type MemeReady = {
  answerId: string;
  memeUrl: string | null;
  scene: Scene;
  verdict: Verdict;
  conceptNote: string;
  misconception: string | null;
  understood: boolean;
};

export type GuessCard = {
  answerId: string;
  memeUrl: string | null;
  scene: Scene;
  /** Shuffled per meme; the concept itself is never labelled as the answer. */
  choices: string[];
  authorNickname: string;
  index: number;
  total: number;
  /** Server clock when the round opened, for the countdown. */
  openedAt: number;
  durationMs: number;
};

export type RevealPayload = {
  answerId: string;
  rawText: string;
  verdict: Verdict;
  correctChoice: string;
  teachingPoint: string;
  conceptNote: string;
  misconception: string | null;
  author: string;
  tally: Record<string, number>;
};

export type ScoreRow = { playerId: string; nickname: string; score: number; rank: number };

/** Per-answer status list the teacher watches during GENERATING. */
export type GenerationStatus = {
  answerId: string;
  playerId: string;
  nickname: string;
  stage: MemeStage | 'done' | 'failed';
  verdict: Verdict | null;
  promoted: boolean;
  hasFile: boolean;
  rawText: string;
};

export type ClientToServer = {
  'room:join': (
    p: {
      code: string;
      nickname?: string;
      playerId?: string;
      teacherKey?: string;
      /** Projector: watches the room without becoming a Player. */
      asScreen?: boolean;
    },
    ack?: (r: { ok: true; playerId: string | null; isTeacher: boolean } | { ok: false; error: string }) => void,
  ) => void;
  'answer:submit': (
    p: { questionId: string; text: string },
    ack?: (r: { ok: true; answerId: string } | { ok: false; error: string }) => void,
  ) => void;
  'guess:submit': (
    p: { answerId: string; choice: string },
    ack?: (r: { ok: true; correct: boolean; points: number } | { ok: false; error: string }) => void,
  ) => void;
  'meme:upload': (
    p: { answerId: string; mime: string; bytes: ArrayBuffer },
    ack?: (r: { ok: true; memeUrl: string } | { ok: false; error: string }) => void,
  ) => void;
  'teacher:phase': (p: { phase: Phase }, ack?: (r: { ok: boolean; error?: string }) => void) => void;
  'teacher:promote': (p: { answerId: string; on: boolean }) => void;
  'teacher:question': (
    p: { prompt: string; targetConcept: string; conceptHint?: string; subject?: string },
    ack?: (r: { ok: true; questionId: string } | { ok: false; error: string }) => void,
  ) => void;
  'teacher:guess-next': (p: { index?: number }) => void;
};

export type ServerToClient = {
  'room:state': (s: RoomState) => void;
  'meme:progress': (p: { answerId: string; stage: MemeStage }) => void;
  'meme:ready': (p: MemeReady) => void;
  'meme:mine': (p: MemeReady) => void;
  'generation:status': (p: { rows: GenerationStatus[] }) => void;
  'guess:card': (p: GuessCard | null) => void;
  'guess:tally': (p: { answerId: string; counts: Record<string, number>; voted: number }) => void;
  'reveal:answer': (p: RevealPayload) => void;
  scoreboard: (p: { rows: ScoreRow[] }) => void;
  error: (p: { message: string }) => void;
};

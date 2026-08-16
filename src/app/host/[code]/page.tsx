'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode, SVGProps } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { rememberTeacherKey, useRoom } from '@/lib/realtime/client';
import { th } from '@/lib/i18n/th';
import {
  SOLO_CLASS_NICKNAME,
  type GenerationStatus,
  type GuessCard,
  type Phase,
  type RevealPayload,
  type ScoreRow,
} from '@/lib/realtime/events';
import type { Verdict } from '@/lib/meme/vocab';
import type { DialogueLine } from '@/lib/ai/scene-schema';

const VERDICT_LABEL: Record<Verdict, string> = {
  correct: th.verdictCorrect,
  partial: th.verdictPartial,
  misconception: th.verdictMisconception,
  off_topic: th.verdictOffTopic,
};

const PHASE_LABEL: Record<Phase, string> = {
  LOBBY: th.phaseLobby,
  ANSWERING: th.phaseAnswering,
  GENERATING: th.phaseGenerating,
  PERSONAL_REVEAL: th.phasePersonalReveal,
  CLASS_GUESS: th.phaseClassGuess,
  REVEAL: th.phaseReveal,
  SCOREBOARD: th.phaseScoreboard,
};

type IconProps = SVGProps<SVGSVGElement>;

function IconPeople(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z"
      />
    </svg>
  );
}

function IconChat(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3.75 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm3.75 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z"
      />
    </svg>
  );
}

function IconPlay(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.5.87l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function IconExit(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H3"
      />
    </svg>
  );
}

function IconMonitor(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25m18 0A2.25 2.25 0 0 0 18.75 3H5.25A2.25 2.25 0 0 0 3 5.25m18 0V12a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 12V5.25"
      />
    </svg>
  );
}

function IconQuestion(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 17.25h.008v.008H12v-.008Z" />
    </svg>
  );
}

function IconGear(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 0 1 0 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 0 1 0-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281Z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function IconDoc(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
      />
    </svg>
  );
}

function IconBook(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25"
      />
    </svg>
  );
}

function IconSend(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M3.478 2.405a.75.75 0 0 0-.926.94l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.405Z" />
    </svg>
  );
}

function IconBulb(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
      />
    </svg>
  );
}

function IconSparkle(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6L12 2Z" />
    </svg>
  );
}

const FORM_ROW_TONE = {
  orange: 'bg-pop/15 text-pop',
  mint: 'bg-mint/15 text-mint',
  sky: 'bg-sky/15 text-sky',
  grape: 'bg-grape/15 text-grape',
} as const;

function FormRow({
  icon,
  tone,
  label,
  children,
}: {
  icon: ReactNode;
  tone: keyof typeof FORM_ROW_TONE;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${FORM_ROW_TONE[tone]}`}
      >
        {icon}
      </span>
      <label className="grid flex-1 gap-1.5">
        <span className="text-xs font-black uppercase tracking-wide text-ink/50">{label}</span>
        {children}
      </label>
    </div>
  );
}

/** The one button that matters in each phase — also what Space triggers. */
function primaryAction(phase: Phase): { to: Phase; label: string } | null {
  switch (phase) {
    case 'LOBBY':
      return { to: 'ANSWERING', label: th.startAnswering };
    case 'ANSWERING':
      return { to: 'GENERATING', label: th.closeAnswers };
    case 'GENERATING':
      return { to: 'PERSONAL_REVEAL', label: th.showPersonalMemes };
    case 'PERSONAL_REVEAL':
      return { to: 'CLASS_GUESS', label: th.startClassGuess };
    case 'CLASS_GUESS':
      return { to: 'REVEAL', label: th.revealAnswer };
    case 'REVEAL':
      return { to: 'SCOREBOARD', label: th.showScoreboard };
    case 'SCOREBOARD':
      return { to: 'ANSWERING', label: th.askAnotherQuestion };
    default:
      return null;
  }
}

export default function HostPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();
  const router = useRouter();

  // `?key=…` lets the seeded room be opened from a link. Runs during the first
  // render so the key is in localStorage before useRoom tries to join.
  useState(() => {
    if (typeof window === 'undefined') return null;
    const key = new URLSearchParams(window.location.search).get('key');
    if (key && code) rememberTeacherKey(code, key);
    return null;
  });

  const { socket, state, connected, error } = useRoom(code, { role: 'teacher' });

  const [rows, setRows] = useState<GenerationStatus[]>([]);
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [guessIndex, setGuessIndex] = useState(0);
  const [guessTotal, setGuessTotal] = useState(0);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const [prompt, setPrompt] = useState(
    'ยกตัวอย่างเหตุการณ์ในชีวิตประจำวันที่เกี่ยวข้องกับกฎข้อที่ 3 ของนิวตัน',
  );
  const [targetConcept, setTargetConcept] = useState("Newton's Third Law");
  const [conceptHint, setConceptHint] = useState('ทุกแรงกิริยามีแรงปฏิกิริยาขนาดเท่ากันแต่ทิศตรงข้าม');
  const [subject, setSubject] = useState('science');
  const [memeStyle, setMemeStyle] = useState<'default' | 'cartoon' | 'brainrot'>('default');

  const [proxyNickname, setProxyNickname] = useState('');
  const [proxyText, setProxyText] = useState('');
  const [proxySending, setProxySending] = useState(false);
  const [proxyNotice, setProxyNotice] = useState<string | null>(null);

  const [guessCard, setGuessCard] = useState<GuessCard | null>(null);
  const [pickedChoice, setPickedChoice] = useState<string | null>(null);

  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Per-answer opt-out of the auto-matched meme character — defaults to
  // using the match (true here means "rejected", so an empty/default map
  // entry naturally means "use it").
  const [rejectedMatch, setRejectedMatch] = useState<Record<string, boolean>>({});

  const phase = state?.phase ?? 'LOBBY';
  const isSolo = state?.mode === 'SOLO';

  useEffect(() => {
    const onStatus = (p: { rows: GenerationStatus[] }) => setRows(p.rows);
    const onReveal = (r: RevealPayload) => setReveal(r);
    const onScores = (p: { rows: ScoreRow[] }) => setScores(p.rows);
    const onCard = (c: GuessCard | null) => {
      setGuessIndex(c?.index ?? 0);
      setGuessTotal(c?.total ?? 0);
      setGuessCard(c);
      setPickedChoice(null);
      if (c) setReveal(null);
    };

    socket.on('generation:status', onStatus);
    socket.on('reveal:answer', onReveal);
    socket.on('scoreboard', onScores);
    socket.on('guess:card', onCard);
    return () => {
      socket.off('generation:status', onStatus);
      socket.off('reveal:answer', onReveal);
      socket.off('scoreboard', onScores);
      socket.off('guess:card', onCard);
    };
  }, [socket]);

  const go = useCallback(
    (to: Phase) => {
      socket.emit('teacher:phase', { phase: to }, (res) => {
        if (!res.ok && res.error) setNotice(res.error);
        else setNotice(null);
      });
    },
    [socket],
  );

  const action = primaryAction(phase);
  const hasMoreMemes = phase === 'REVEAL' && guessIndex + 1 < guessTotal;
  // The projector's running order is fixed once guessing opens; the server
  // refuses changes from here on, so the button says so instead of failing.
  const orderLocked = phase === 'CLASS_GUESS' || phase === 'REVEAL';

  // space = advance
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const el = e.target as HTMLElement | null;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      e.preventDefault();
      if (hasMoreMemes) socket.emit('teacher:guess-next', {});
      else if (action) go(action.to);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [action, go, hasMoreMemes, socket]);

  function submitForStudent() {
    const questionId = state?.question?.id;
    const nickname = isSolo ? SOLO_CLASS_NICKNAME : proxyNickname.trim();
    if (!questionId || !nickname || !proxyText.trim() || proxySending) return;
    setProxySending(true);
    setProxyNotice(null);
    socket.emit(
      'teacher:submit-answer',
      { questionId, nickname, text: proxyText.trim() },
      (res) => {
        setProxySending(false);
        if (res.ok) {
          setProxyNotice(isSolo ? th.proxySentSolo : th.proxySent(res.nickname));
          setProxyText('');
        } else {
          setProxyNotice(res.error);
        }
      },
    );
  }

  function dialogueToText(dialogue: DialogueLine[]): string {
    return dialogue.map((d) => `${d.speaker}: ${d.line}`).join('\n');
  }

  function textToDialogue(text: string): DialogueLine[] {
    return text
      .split('\n')
      .map((line) => {
        const i = line.indexOf(':');
        if (i === -1) return null;
        const speaker = line.slice(0, i).trim();
        const rest = line.slice(i + 1).trim();
        return speaker && rest ? { speaker, line: rest } : null;
      })
      .filter((d): d is DialogueLine => d !== null)
      .slice(0, 4);
  }

  function startEditingDialogue(row: GenerationStatus) {
    setEditingRow(row.answerId);
    setEditText(dialogueToText(row.dialogue));
  }

  function saveDialogueEdit(answerId: string) {
    if (editSaving) return;
    setEditSaving(true);
    socket.emit(
      'teacher:edit-dialogue',
      { answerId, dialogue: textToDialogue(editText) },
      (res) => {
        setEditSaving(false);
        if (res.ok) setEditingRow(null);
        else setNotice(res.error);
      },
    );
  }

  function pickGuess(choice: string) {
    if (!guessCard || pickedChoice) return;
    socket.emit('teacher:guess-pick', { answerId: guessCard.answerId, choice }, (res) => {
      if (res.ok) setPickedChoice(choice);
      else setNotice(res.error ?? null);
    });
  }

  function postQuestion() {
    socket.emit(
      'teacher:question',
      { prompt, targetConcept, conceptHint, subject, memeStyle },
      (res) => {
        if (!res.ok) setNotice(res.error);
        else setNotice(null);
      },
    );
  }

  if (error === 'no-teacher-key') {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-paper p-6">
        <div className="chunk max-w-md bg-white p-6 text-center">
          <p className="font-black text-ink">{th.noTeacherKey}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-paper p-4">
      <main className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-[1.1fr_1fr]">
        {/* header spans both columns */}
        <header className="chunk flex flex-wrap items-center justify-between gap-3 bg-sun px-6 py-4 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-3xl font-black tracking-[0.08em] text-ink">{code}</span>
            <span className="tag bg-white">
              <span className="size-2 rounded-full bg-mint" aria-hidden="true" />
              {PHASE_LABEL[phase]}
            </span>
            {!connected && <span className="tag bg-berry text-white">{th.disconnected}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="tag bg-white">
              <IconPeople className="size-4" />
              {th.players} {state?.playerCount ?? 0}
            </span>
            <span className="tag bg-white">
              <IconChat className="size-4" />
              {th.answered} {state?.answeredCount ?? 0}
            </span>
            <a className="tag bg-white transition hover:brightness-105" href={`/screen/${code}`} target="_blank">
              <IconMonitor className="size-4" />
              {th.openProjector}
            </a>
            <button
              className="tag bg-ink text-white transition hover:brightness-110"
              onClick={() => router.push('/')}
            >
              <IconExit className="size-4" />
              {th.exitGame}
            </button>
          </div>
        </header>

        {/* left: controls */}
        <div className="flex flex-col gap-4">
          <section className="chunk bg-white p-5">
            <div className="flex flex-col gap-3">
              {action && (
                <button className="btn btn-pop w-full gap-2 py-4 text-lg" onClick={() => go(action.to)}>
                  <IconPlay className="size-5" />
                  {action.label}
                </button>
              )}
              {hasMoreMemes && (
                <button
                  className="btn btn-sky w-full gap-2 py-4 text-lg"
                  onClick={() => socket.emit('teacher:guess-next', {})}
                >
                  {th.nextMeme} ({guessIndex + 2}/{guessTotal})
                </button>
              )}
              {phase === 'REVEAL' && (
                <button className="btn btn-ghost w-full" onClick={() => go('ANSWERING')}>
                  {th.askAnotherQuestion}
                </button>
              )}
              {phase === 'PERSONAL_REVEAL' && (
                <button className="btn btn-ghost w-full" onClick={() => go('SCOREBOARD')}>
                  {th.showScoreboard}
                </button>
              )}
            </div>
            <p className="mt-3 text-center text-xs font-bold text-ink/40">{th.spaceToAdvance}</p>
            {notice && (
              <p className="chunk-sm mt-3 bg-berry/10 px-3 py-2 text-sm font-bold text-berry">
                {notice}
              </p>
            )}
          </section>

          <section className="chunk bg-white p-5">
            <h2 className="flex items-center gap-2.5 text-lg font-black text-ink">
              <span className="flex size-8 items-center justify-center rounded-full bg-sun/40 text-ink/70">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="size-4">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                  />
                </svg>
              </span>
              {th.newQuestion}
            </h2>
            <div className="mt-4 grid gap-4">
              <FormRow icon={<IconQuestion className="size-[18px]" />} tone="orange" label={th.questionPrompt}>
                <textarea
                  className="host-field min-h-20 resize-none"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </FormRow>
              <FormRow icon={<IconGear className="size-[18px]" />} tone="mint" label={th.targetConcept}>
                <input
                  className="host-field"
                  value={targetConcept}
                  onChange={(e) => setTargetConcept(e.target.value)}
                />
              </FormRow>
              <FormRow icon={<IconDoc className="size-[18px]" />} tone="sky" label={th.conceptHint}>
                <input
                  className="host-field"
                  value={conceptHint}
                  onChange={(e) => setConceptHint(e.target.value)}
                />
              </FormRow>
              <FormRow icon={<IconBook className="size-[18px]" />} tone="grape" label={th.subject}>
                <select
                  className="host-field"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                >
                  <option value="science">วิทยาศาสตร์</option>
                  <option value="math">คณิตศาสตร์</option>
                  <option value="social">สังคมศึกษา</option>
                </select>
              </FormRow>
              <FormRow icon={<IconSparkle className="size-[18px]" />} tone="sky" label={th.memeStyle}>
                <select
                  className="host-field"
                  value={memeStyle}
                  onChange={(e) => setMemeStyle(e.target.value as 'default' | 'cartoon' | 'brainrot')}
                >
                  <option value="default">{th.memeStyleDefault}</option>
                  <option value="cartoon">{th.memeStyleCartoon}</option>
                  <option value="brainrot">{th.memeStyleBrainrot}</option>
                </select>
              </FormRow>
              <button className="btn btn-mint w-full gap-2" onClick={postQuestion}>
                <IconSend className="size-4" />
                {th.postQuestion}
              </button>
            </div>
          </section>

          {phase === 'CLASS_GUESS' && isSolo && guessCard && (
            <section className="chunk bg-sky/10 p-5">
              <h2 className="flex items-center gap-2.5 text-lg font-black text-ink">
                <span className="flex size-8 items-center justify-center rounded-full bg-sky/20 text-sky">
                  <IconPeople className="size-4" />
                </span>
                {th.guessPickTitle}
              </h2>
              <p className="mt-2 text-sm font-bold leading-relaxed text-ink/50">{th.guessPickHint}</p>
              <div className="mt-4 grid gap-2.5">
                {guessCard.choices.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className={`btn w-full text-left ${
                      pickedChoice === choice ? 'btn-mint' : 'bg-white'
                    }`}
                    onClick={() => pickGuess(choice)}
                    disabled={pickedChoice !== null}
                  >
                    {choice}
                  </button>
                ))}
              </div>
              {pickedChoice && (
                <p className="chunk-sm mt-3 bg-paper-2 px-3 py-2 text-sm font-bold text-ink/70">
                  {th.guessPicked}
                </p>
              )}
            </section>
          )}

          {phase === 'ANSWERING' && state?.question && (
            <section className="chunk bg-white p-5">
              <h2 className="flex items-center gap-2.5 text-lg font-black text-ink">
                <span className="flex size-8 items-center justify-center rounded-full bg-sky/20 text-sky">
                  <IconPeople className="size-4" />
                </span>
                {isSolo ? th.proxyAnswerTitleSolo : th.proxyAnswerTitle}
              </h2>
              <p className="mt-2 text-sm font-bold leading-relaxed text-ink/50">
                {isSolo ? th.proxyAnswerHintSolo : th.proxyAnswerHint}
              </p>
              <div className="mt-4 grid gap-3">
                {!isSolo && (
                  <label className="grid gap-1.5">
                    <span className="text-xs font-black uppercase tracking-wide text-ink/50">
                      {th.proxyNickname}
                    </span>
                    <input
                      className="host-field"
                      value={proxyNickname}
                      onChange={(e) => setProxyNickname(e.target.value.slice(0, 20))}
                      placeholder={th.nicknamePlaceholder}
                    />
                  </label>
                )}
                <label className="grid gap-1.5">
                  <span className="text-xs font-black uppercase tracking-wide text-ink/50">
                    {th.yourAnswer}
                  </span>
                  <textarea
                    className={`host-field resize-none ${
                      isSolo ? 'min-h-40 text-xl leading-relaxed' : 'min-h-20'
                    }`}
                    value={proxyText}
                    onChange={(e) => setProxyText(e.target.value.slice(0, 600))}
                    placeholder={th.answerPlaceholder}
                    autoFocus={isSolo}
                  />
                </label>
                <button
                  className={`btn btn-sky w-full gap-2 ${isSolo ? 'py-4 text-lg' : ''}`}
                  onClick={submitForStudent}
                  disabled={(!isSolo && !proxyNickname.trim()) || !proxyText.trim() || proxySending}
                >
                  <IconSend className="size-4" />
                  {proxySending ? th.proxySending : th.proxySubmit}
                </button>
                {proxyNotice && (
                  <p className="chunk-sm bg-paper-2 px-3 py-2 text-sm font-bold text-ink/70">
                    {proxyNotice}
                  </p>
                )}
              </div>
            </section>
          )}

          {phase === 'REVEAL' && reveal && (
            <section className="chunk bg-sun/25 p-5">
              <h2 className="text-base font-black text-ink">{th.teachingPoint}</h2>
              <p className="mt-2 font-bold leading-relaxed text-ink/80">
                {reveal.teachingPoint || '—'}
              </p>
              {reveal.misconception && (
                <p className="chunk-sm mt-3 bg-pop px-3 py-2.5 text-sm font-black text-white">
                  {reveal.misconception}
                </p>
              )}
              <p className="mt-3 text-sm font-bold text-ink/50">
                {th.originalAnswer} · {reveal.author}: {reveal.rawText}
              </p>
            </section>
          )}
        </div>

        {/* right: per-student status */}
        <div className="flex flex-col gap-4">
          <section className="chunk bg-white p-5">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-full bg-sun/30 text-ink/70">
                <IconChat className="size-[18px]" />
              </span>
              <h2 className="text-lg font-black text-ink">
                {th.answered} <span className="text-ink/30">·</span> {rows.length}
              </h2>
            </div>

            {rows.length === 0 ? (
              <div className="mt-6 flex flex-col items-center gap-5 py-4 text-center">
                <div className="relative flex size-40 items-center justify-center rounded-full bg-[radial-gradient(circle_at_center,#fff3cf_0%,rgba(255,243,207,0)_70%)]">
                  <IconSparkle className="absolute left-3 top-4 size-4 text-sun" />
                  <IconSparkle className="absolute right-4 top-9 size-3 text-sun/70" />
                  <IconSparkle className="absolute bottom-5 left-7 size-2.5 text-sun/60" />
                  <IconPeople className="size-14 text-sun" />
                </div>
                <p className="text-sm font-bold text-ink/40">{th.waitingForPlayers}</p>
              </div>
            ) : (
              <ul className="mt-4 grid gap-2.5">
                {rows.map((row) => (
                  <li key={row.answerId} className="chunk-sm grid gap-1.5 bg-[#f7f8fa] p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-black text-ink">{row.nickname}</span>
                      <div className="flex items-center gap-1.5">
                        {row.verdict && (
                          <span className="tag bg-white">{VERDICT_LABEL[row.verdict]}</span>
                        )}
                        <span className="tag bg-paper-2">{stageLabel(row)}</span>
                      </div>
                    </div>
                    <p className="line-clamp-2 text-sm font-bold text-ink/60">{row.rawText}</p>
                    {row.matchedMemeName &&
                      row.promoted &&
                      row.stage === 'done' &&
                      !row.memeUrl?.endsWith('-ai.png') && (
                        <label className="flex items-center gap-1.5 text-xs font-bold text-ink/60">
                          <input
                            type="checkbox"
                            checked={!rejectedMatch[row.answerId]}
                            onChange={(e) =>
                              setRejectedMatch((prev) => ({
                                ...prev,
                                [row.answerId]: !e.target.checked,
                              }))
                            }
                          />
                          {th.matchedMemeLabel(row.matchedMemeName)}
                        </label>
                      )}
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        className={`tag transition ${
                          row.promoted ? 'bg-sun' : 'bg-white hover:bg-paper-2'
                        } ${orderLocked ? 'cursor-not-allowed opacity-50' : ''}`}
                        disabled={orderLocked}
                        title={orderLocked ? th.orderLocked : undefined}
                        onClick={() =>
                          socket.emit(
                            'teacher:promote',
                            { answerId: row.answerId, on: !row.promoted },
                            (res) => setNotice(res.ok ? null : (res.error ?? null)),
                          )
                        }
                      >
                        {row.promoted ? th.promoted : th.promote}
                      </button>
                      {row.stage === 'failed' && (
                        <button
                          className="tag bg-sky text-white transition hover:brightness-105"
                          onClick={() =>
                            socket.emit('teacher:reanalyze', { answerId: row.answerId }, (res) =>
                              setNotice(res.ok ? null : (res.error ?? null)),
                            )
                          }
                        >
                          {th.retryAnalysis}
                        </button>
                      )}
                      {row.promoted && row.stage === 'done' && !row.memeUrl?.endsWith('-ai.png') && (
                        <button
                          className="tag bg-grape text-white transition hover:brightness-105"
                          onClick={() =>
                            socket.emit(
                              'teacher:generate-ai-meme',
                              { answerId: row.answerId, ignoreMatch: rejectedMatch[row.answerId] ?? false },
                              (res) => setNotice(res.ok ? null : (res.error ?? null)),
                            )
                          }
                        >
                          {th.generateAiMeme}
                        </button>
                      )}
                      {row.stage === 'ai_rendering' && (
                        <span className="tag bg-grape/20 text-ink/60">{th.generatingAiMeme}</span>
                      )}
                      {row.memeUrl?.endsWith('-ai.png') && editingRow !== row.answerId && (
                        <button
                          className="tag bg-white transition hover:bg-paper-2"
                          onClick={() => startEditingDialogue(row)}
                        >
                          {th.editDialogue}
                        </button>
                      )}
                      {row.memeUrl && (
                        <button
                          className={`tag transition ${
                            previewId === row.answerId ? 'bg-indigo-600 text-white' : 'bg-white hover:bg-paper-2'
                          }`}
                          onClick={() => setPreviewId(previewId === row.answerId ? null : row.answerId)}
                        >
                          {previewId === row.answerId ? 'ซ่อนมีม' : 'ดูมีม'}
                        </button>
                      )}
                    </div>
                    {previewId === row.answerId && row.memeUrl && (
                      <div className="mt-2 flex justify-center rounded-lg bg-black/5 p-2">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={row.memeUrl}
                          alt="Meme preview"
                          className="max-h-48 rounded shadow-sm"
                        />
                      </div>
                    )}
                    {editingRow === row.answerId && (
                      <div className="mt-1 grid gap-2">
                        <p className="text-xs font-bold text-ink/40">{th.editDialogueHint}</p>
                        <textarea
                          className="host-field min-h-24 resize-none text-sm"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                        />
                        <div className="flex gap-1.5">
                          <button
                            className="tag bg-mint text-white transition hover:brightness-105"
                            onClick={() => saveDialogueEdit(row.answerId)}
                            disabled={editSaving}
                          >
                            {editSaving ? th.proxySending : th.save}
                          </button>
                          <button
                            className="tag bg-white transition hover:bg-paper-2"
                            onClick={() => setEditingRow(null)}
                            disabled={editSaving}
                          >
                            {th.cancel}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {rows.length === 0 && (
            <section className="chunk bg-sun/20 p-5">
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sun/40 text-ink/70">
                  <IconBulb className="size-[18px]" />
                </span>
                <div>
                  <h3 className="font-black text-ink">{th.teacherTipTitle}</h3>
                  <p className="mt-1 text-sm font-bold leading-relaxed text-ink/50">
                    {th.teacherTipBody}
                  </p>
                </div>
              </div>
            </section>
          )}

          {scores.length > 0 && (
            <section className="chunk bg-white p-5">
              <h2 className="text-lg font-black text-ink">{th.phaseScoreboard}</h2>
              <ol className="mt-3 grid gap-1.5">
                {scores.slice(0, 10).map((r) => (
                  <li key={r.playerId} className="flex justify-between font-black text-ink">
                    <span>
                      {r.rank}. {r.nickname}
                    </span>
                    <span className="tabular-nums text-ink/70">{r.score}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

function stageLabel(row: GenerationStatus): string {
  switch (row.stage) {
    case 'analyzing':
      return th.stageAnalyzing;
    case 'composing':
      return th.stageComposing;
    case 'encoding':
      return th.stageEncoding;
    case 'ai_rendering':
      return th.stageAiRendering;
    case 'failed':
      return th.error;
    default:
      if (!row.hasFile) return '✓';
      return row.memeUrl?.endsWith('-ai.png') ? 'AI ✓' : 'GIF ✓';
  }
}

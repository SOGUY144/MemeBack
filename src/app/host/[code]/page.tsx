'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { rememberTeacherKey, useRoom } from '@/lib/realtime/client';
import { th } from '@/lib/i18n/th';
import type { GenerationStatus, Phase, RevealPayload, ScoreRow } from '@/lib/realtime/events';
import type { Verdict } from '@/lib/meme/vocab';

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

  const [prompt, setPrompt] = useState(
    'ยกตัวอย่างเหตุการณ์ในชีวิตประจำวันที่เกี่ยวข้องกับกฎข้อที่ 3 ของนิวตัน',
  );
  const [targetConcept, setTargetConcept] = useState("Newton's Third Law");
  const [conceptHint, setConceptHint] = useState('ทุกแรงกิริยามีแรงปฏิกิริยาขนาดเท่ากันแต่ทิศตรงข้าม');
  const [subject, setSubject] = useState('science');

  const phase = state?.phase ?? 'LOBBY';

  useEffect(() => {
    const onStatus = (p: { rows: GenerationStatus[] }) => setRows(p.rows);
    const onReveal = (r: RevealPayload) => setReveal(r);
    const onScores = (p: { rows: ScoreRow[] }) => setScores(p.rows);
    const onCard = (c: { index: number; total: number } | null) => {
      setGuessIndex(c?.index ?? 0);
      setGuessTotal(c?.total ?? 0);
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

  function postQuestion() {
    socket.emit(
      'teacher:question',
      { prompt, targetConcept, conceptHint, subject },
      (res) => {
        if (!res.ok) setNotice(res.error);
        else setNotice(null);
      },
    );
  }

  if (error === 'no-teacher-key') {
    return (
      <main className="mx-auto max-w-lg p-8">
        <div className="chunk bg-sun p-6 font-black">{th.noTeacherKey}</div>
      </main>
    );
  }

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-4 p-4 lg:grid-cols-[1.1fr_1fr]">
      {/* header spans both columns */}
      <header className="chunk flex flex-wrap items-center justify-between gap-3 bg-sun p-4 lg:col-span-2">
        <div className="flex items-center gap-3">
          <span className="text-3xl font-black tracking-[0.2em]">{code}</span>
          <span className="tag bg-white">{PHASE_LABEL[phase]}</span>
          {!connected && <span className="tag bg-berry text-white">{th.disconnected}</span>}
        </div>
        <div className="flex items-center gap-2 text-sm font-black">
          <span className="tag bg-white">
            {th.players} {state?.playerCount ?? 0}
          </span>
          <span className="tag bg-white">
            {th.answered} {state?.answeredCount ?? 0}
          </span>
          <a className="btn btn-ghost px-3 py-1.5 text-sm" href={`/screen/${code}`} target="_blank">
            {th.openProjector}
          </a>
        </div>
      </header>

      {/* left: controls */}
      <div className="flex flex-col gap-4">
        <section className="chunk p-4">
          <div className="flex flex-wrap gap-2">
            {action && (
              <button className="btn btn-pop flex-1" onClick={() => go(action.to)}>
                {action.label}
              </button>
            )}
            {hasMoreMemes && (
              <button
                className="btn btn-sky flex-1"
                onClick={() => socket.emit('teacher:guess-next', {})}
              >
                {th.nextMeme} ({guessIndex + 2}/{guessTotal})
              </button>
            )}
            {phase === 'REVEAL' && (
              <button className="btn btn-ghost" onClick={() => go('ANSWERING')}>
                {th.askAnotherQuestion}
              </button>
            )}
            {phase === 'PERSONAL_REVEAL' && (
              <button className="btn btn-ghost" onClick={() => go('SCOREBOARD')}>
                {th.showScoreboard}
              </button>
            )}
          </div>
          <p className="mt-3 text-xs font-black text-ink/50">{th.spaceToAdvance}</p>
          {notice && (
            <p className="chunk-sm mt-3 bg-berry p-2 text-sm font-black text-white">{notice}</p>
          )}
        </section>

        <section className="chunk p-4">
          <h2 className="text-xl">{th.newQuestion}</h2>
          <div className="mt-3 grid gap-3">
            <label className="grid gap-1">
              <span className="text-xs font-black uppercase tracking-wide">
                {th.questionPrompt}
              </span>
              <textarea
                className="field min-h-20 resize-none"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-black uppercase tracking-wide">
                {th.targetConcept}
              </span>
              <input
                className="field"
                value={targetConcept}
                onChange={(e) => setTargetConcept(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-black uppercase tracking-wide">{th.conceptHint}</span>
              <input
                className="field"
                value={conceptHint}
                onChange={(e) => setConceptHint(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-black uppercase tracking-wide">{th.subject}</span>
              <select
                className="field"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              >
                <option value="science">วิทยาศาสตร์</option>
                <option value="math">คณิตศาสตร์</option>
                <option value="social">สังคมศึกษา</option>
              </select>
            </label>
            <button className="btn btn-mint" onClick={postQuestion}>
              {th.postQuestion}
            </button>
          </div>
        </section>

        {phase === 'REVEAL' && reveal && (
          <section className="chunk bg-paper-2 p-4">
            <h2 className="text-lg">{th.teachingPoint}</h2>
            <p className="mt-2 font-bold leading-relaxed">{reveal.teachingPoint || '—'}</p>
            {reveal.misconception && (
              <p className="chunk-sm mt-3 bg-pop p-3 text-sm font-black text-white">
                {reveal.misconception}
              </p>
            )}
            <p className="mt-3 text-sm font-bold text-ink/60">
              {th.originalAnswer} · {reveal.author}: {reveal.rawText}
            </p>
          </section>
        )}
      </div>

      {/* right: per-student status */}
      <div className="flex flex-col gap-4">
        <section className="chunk p-4">
          <h2 className="text-xl">
            {th.answered} · {rows.length}
          </h2>
          <ul className="mt-3 grid gap-2">
            {rows.map((row) => (
              <li key={row.answerId} className="chunk-sm grid gap-1.5 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-black">{row.nickname}</span>
                  <div className="flex items-center gap-1.5">
                    {row.verdict && <span className="tag">{VERDICT_LABEL[row.verdict]}</span>}
                    <span className="tag bg-paper-2">{stageLabel(row)}</span>
                  </div>
                </div>
                <p className="line-clamp-2 text-sm font-bold text-ink/70">{row.rawText}</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    className={`btn px-3 py-1.5 text-sm ${row.promoted ? 'btn-sun' : 'btn-ghost'}`}
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
                      className="btn btn-sky px-3 py-1.5 text-sm"
                      onClick={() =>
                        socket.emit('teacher:reanalyze', { answerId: row.answerId }, (res) =>
                          setNotice(res.ok ? null : (res.error ?? null)),
                        )
                      }
                    >
                      {th.retryAnalysis}
                    </button>
                  )}
                </div>
              </li>
            ))}
            {rows.length === 0 && (
              <li className="text-sm font-bold text-ink/50">{th.waitingForPlayers}</li>
            )}
          </ul>
        </section>

        {scores.length > 0 && (
          <section className="chunk p-4">
            <h2 className="text-xl">{th.phaseScoreboard}</h2>
            <ol className="mt-3 grid gap-1.5">
              {scores.slice(0, 10).map((r) => (
                <li key={r.playerId} className="flex justify-between font-black">
                  <span>
                    {r.rank}. {r.nickname}
                  </span>
                  <span className="tabular-nums">{r.score}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </main>
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
    case 'failed':
      return th.error;
    default:
      return row.hasFile ? 'GIF ✓' : '✓';
  }
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { MemeMedia } from '@/components/meme/MemeMedia';
import { useRoom } from '@/lib/realtime/client';
import { th } from '@/lib/i18n/th';
import type { GuessCard, RevealPayload, ScoreRow } from '@/lib/realtime/events';
import type { Verdict } from '@/lib/meme/vocab';

const VERDICT_LABEL: Record<Verdict, string> = {
  correct: th.verdictCorrect,
  partial: th.verdictPartial,
  misconception: th.verdictMisconception,
  off_topic: th.verdictOffTopic,
};

export default function ScreenPage() {
  const params = useParams<{ code: string }>();
  const code = (params.code ?? '').toUpperCase();
  const { socket, state } = useRoom(code, { role: 'screen' });

  const [qr, setQr] = useState<string | null>(null);
  const [card, setCard] = useState<GuessCard | null>(null);
  const [tally, setTally] = useState<{ counts: Record<string, number>; voted: number }>({
    counts: {},
    voted: 0,
  });
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [now, setNow] = useState(() => Date.now());

  const phase = state?.phase ?? 'LOBBY';

  useEffect(() => {
    const url = `${window.location.origin}/play/${code}`;
    import('qrcode')
      .then((qrcode) =>
        qrcode.toDataURL(url, {
          width: 420,
          margin: 1,
          color: { dark: '#111318', light: '#FFFFFF' },
        }),
      )
      .then(setQr)
      .catch(() => setQr(null));
  }, [code]);

  useEffect(() => {
    const onCard = (c: GuessCard | null) => {
      setCard(c);
      setTally({ counts: {}, voted: 0 });
      if (c) setReveal(null);
    };
    const onTally = (p: { answerId: string; counts: Record<string, number>; voted: number }) =>
      setTally({ counts: p.counts, voted: p.voted });
    const onReveal = (r: RevealPayload) => setReveal(r);
    const onScores = (p: { rows: ScoreRow[] }) => setScores(p.rows);

    socket.on('guess:card', onCard);
    socket.on('guess:tally', onTally);
    socket.on('reveal:answer', onReveal);
    socket.on('scoreboard', onScores);
    return () => {
      socket.off('guess:card', onCard);
      socket.off('guess:tally', onTally);
      socket.off('reveal:answer', onReveal);
      socket.off('scoreboard', onScores);
    };
  }, [socket]);

  useEffect(() => {
    if (phase !== 'CLASS_GUESS') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [phase]);

  const secondsLeft = card
    ? Math.max(0, Math.ceil((card.openedAt + card.durationMs - now) / 1000))
    : 0;

  const generatingPct = useMemo(() => {
    if (!state) return 0;
    const total = Math.max(1, state.answeredCount);
    return Math.min(100, Math.round((state.answeredCount / total) * 100));
  }, [state]);

  return (
    <main className="screen-root flex min-h-dvh flex-col items-center justify-center gap-8 p-10">
      {phase === 'LOBBY' && (
        <>
          <p className="text-2xl font-black tracking-widest text-sun/80">{th.scanToJoin}</p>
          <div className="flex flex-wrap items-center justify-center gap-12">
            <p className="screen-code">{code}</p>
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr}
                alt="QR"
                className="size-72 rounded-2xl border-8 border-ink bg-white p-2"
              />
            )}
          </div>
          <div className="flex max-w-5xl flex-wrap justify-center gap-3">
            {state?.players.map((p) => (
              <span
                key={p.id}
                className="rounded-full border-4 border-ink bg-sun px-5 py-2 text-2xl font-black text-ink"
              >
                {p.nickname}
              </span>
            ))}
            {(state?.players.length ?? 0) === 0 && (
              <p className="text-3xl font-black text-white/50">{th.waitingForPlayers}</p>
            )}
          </div>
        </>
      )}

      {phase === 'ANSWERING' && (
        <>
          <h1 className="max-w-5xl text-center text-6xl leading-tight">
            {state?.question?.prompt ?? th.loading}
          </h1>
          <p className="text-5xl font-black text-sun">
            {th.submittedCount(state?.answeredCount ?? 0, state?.playerCount ?? 0)}
          </p>
        </>
      )}

      {phase === 'GENERATING' && (
        <>
          <h1 className="text-6xl">{th.phaseGenerating}</h1>
          <div className="h-10 w-4/5 overflow-hidden rounded-full border-4 border-white/70">
            <div
              className="h-full bg-sun transition-all duration-500"
              style={{ width: `${generatingPct}%` }}
            />
          </div>
          <p className="text-3xl font-black text-white/70">
            {th.submittedCount(state?.answeredCount ?? 0, state?.playerCount ?? 0)}
          </p>
        </>
      )}

      {phase === 'PERSONAL_REVEAL' && (
        <>
          <p className="text-8xl">📱</p>
          <h1 className="text-center text-7xl">{th.lookAtYourDevice}</h1>
        </>
      )}

      {phase === 'CLASS_GUESS' && card && (
        <div className="grid w-full max-w-7xl gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <MemeMedia
              memeUrl={card.memeUrl}
              scene={card.scene}
              className="w-full rounded-2xl border-8 border-white/15"
            />
            <p className="mt-4 text-center text-3xl font-black text-sun">
              {card.index + 1} / {card.total} · {secondsLeft} {th.seconds}
            </p>
          </div>
          <div className="flex flex-col justify-center gap-4">
            <h2 className="text-4xl">{th.whatPrinciple}</h2>
            {card.choices.map((choice) => {
              const n = tally.counts[choice] ?? 0;
              const pct = tally.voted ? Math.round((n / tally.voted) * 100) : 0;
              return (
                <div
                  key={choice}
                  className="relative overflow-hidden rounded-xl border-4 border-white/25 px-5 py-4"
                >
                  <div
                    className="absolute inset-y-0 left-0 bg-white/15 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                  <div className="relative flex items-center justify-between gap-4">
                    <span className="text-2xl font-black">{choice}</span>
                    <span className="text-2xl font-black text-sun tabular-nums">{n}</span>
                  </div>
                </div>
              );
            })}
            <p className="text-xl font-black text-white/50">
              {tally.voted} {th.votes}
            </p>
          </div>
        </div>
      )}

      {phase === 'REVEAL' && reveal && (
        <div className="grid w-full max-w-7xl items-center gap-8 lg:grid-cols-[1.2fr_1fr]">
          {card && (
            <MemeMedia
              memeUrl={card.memeUrl}
              scene={card.scene}
              className="w-full rounded-2xl border-8 border-white/15"
            />
          )}
          <div className="flex flex-col gap-5">
            <div>
              <p className="text-xl font-black uppercase tracking-widest text-white/50">
                {th.theAnswerWas}
              </p>
              <h2 className="text-5xl text-sun">{reveal.correctChoice}</h2>
            </div>
            <div className="rounded-2xl border-4 border-white/25 p-5">
              <p className="text-lg font-black uppercase tracking-widest text-white/50">
                {th.originalAnswer} · {th.by} {reveal.author}
              </p>
              <p className="mt-2 text-3xl font-bold leading-snug">{reveal.rawText}</p>
              <span className="mt-4 inline-block rounded-full border-4 border-white/40 px-4 py-1 text-xl font-black">
                {VERDICT_LABEL[reveal.verdict]}
              </span>
            </div>
          </div>
        </div>
      )}

      {phase === 'SCOREBOARD' && (
        <div className="w-full max-w-3xl">
          <h1 className="mb-6 text-center text-6xl text-sun">{th.top10}</h1>
          <ol className="grid gap-3">
            {scores.slice(0, 10).map((r) => (
              <li
                key={r.playerId}
                className="flex items-center justify-between rounded-xl border-4 border-white/25 px-6 py-3 text-4xl font-black"
              >
                <span>
                  {r.rank}. {r.nickname}
                </span>
                <span className="text-sun tabular-nums">{r.score}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </main>
  );
}
